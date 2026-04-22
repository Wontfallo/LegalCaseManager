"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  useChatSessions,
  useCreateChatSession,
  useUpdateChatSession,
  useDeleteChatSession,
  useExportChatToDocument,
  useCaseAssistantChat,
} from "@/hooks/useApi";
import { apiClient } from "@/lib/api";
import type {
  AssistantMessage,
  ChatSessionListItem,
  ChatSessionDetail,
} from "@/types";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  InputAdornment,
  List,
  ListItem,
  ListItemButton,
  Menu,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddCommentIcon from "@mui/icons-material/AddComment";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import FileDownloadIcon from "@mui/icons-material/FileDownload";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import PushPinIcon from "@mui/icons-material/PushPin";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import SearchIcon from "@mui/icons-material/Search";
import SendIcon from "@mui/icons-material/Send";

// ── Types / helpers ──────────────────────────────────────

interface Props {
  caseId: string;
}

const STARTER_PROMPTS = [
  "Organize my files into the right sections.",
  "What documents mention balcony issues?",
  "Summarize the strongest evidence in this case.",
  "Find duplicate documents.",
];

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - date.getTime()) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return "Yesterday";
  if (diffD < 7) return `${diffD}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

type Groups = {
  pinned: ChatSessionListItem[];
  today: ChatSessionListItem[];
  yesterday: ChatSessionListItem[];
  lastWeek: ChatSessionListItem[];
  older: ChatSessionListItem[];
};

function groupSessions(sessions: ChatSessionListItem[]): Groups {
  const pinned: ChatSessionListItem[] = [];
  const today: ChatSessionListItem[] = [];
  const yesterday: ChatSessionListItem[] = [];
  const lastWeek: ChatSessionListItem[] = [];
  const older: ChatSessionListItem[] = [];
  const now = new Date();

  for (const s of sessions) {
    if (s.is_pinned) { pinned.push(s); continue; }
    const d = Math.floor((now.getTime() - new Date(s.created_at).getTime()) / 86400000);
    if (d === 0) today.push(s);
    else if (d === 1) yesterday.push(s);
    else if (d <= 7) lastWeek.push(s);
    else older.push(s);
  }
  return { pinned, today, yesterday, lastWeek, older };
}

// ── Component ────────────────────────────────────────────

export default function AssistantTab({ caseId }: Props) {
  const queryClient = useQueryClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Active session state
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [sessionTitle, setSessionTitle] = useState<string | null>(null);

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Inline rename
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Kebab menu
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [menuSession, setMenuSession] = useState<ChatSessionListItem | null>(null);

  // Chat input
  const [input, setInput] = useState("");

  // Hooks
  const sessionsList = useChatSessions(caseId);
  const updateSession = useUpdateChatSession(caseId);
  const deleteSession = useDeleteChatSession(caseId);
  const exportChat = useExportChatToDocument(caseId);
  const assistantChat = useCaseAssistantChat(caseId);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, assistantChat.isPending]);

  const canSend = input.trim().length > 0 && !assistantChat.isPending;

  // ── Filtering ────────────────────────────────────────
  const allSessions = sessionsList.data ?? [];
  const filteredSessions = debouncedSearch.trim()
    ? allSessions.filter(
        (s) =>
          (s.title ?? "").toLowerCase().includes(debouncedSearch.toLowerCase()) ||
          (s.preview ?? "").toLowerCase().includes(debouncedSearch.toLowerCase())
      )
    : allSessions;
  const grouped = groupSessions(filteredSessions);

  // ── Handlers ─────────────────────────────────────────

  const handleNewChat = () => {
    setActiveSessionId(null);
    setMessages([]);
    setSessionTitle(null);
    setInput("");
  };

  const handleSelectSession = async (session: ChatSessionListItem) => {
    if (session.id === activeSessionId) return;
    try {
      const detail = await apiClient.get<ChatSessionDetail>(
        `/api/cases/${caseId}/chat-sessions/${session.id}`
      );
      setActiveSessionId(detail.id);
      setSessionTitle(detail.title);
      setMessages(detail.messages.map((m) => ({ role: m.role, content: m.content })));
    } catch {
      toast.error("Failed to load chat.");
    }
  };

  const sendMessage = async (content: string) => {
    if (!content.trim()) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content }]);
    try {
      const response = await assistantChat.mutateAsync({
        session_id: activeSessionId,
        message: content,
      });
      setMessages((prev) => [...prev, response.message]);
      setActiveSessionId(response.session_id);
      if (response.session_title) setSessionTitle(response.session_title);
      if (response.tool_calls.some((c) => c.tool_name === "organize_documents")) {
        toast.success("Assistant reorganized the case documents.");
      }
      queryClient.invalidateQueries({ queryKey: ["cases", caseId, "chat-sessions"] });
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Assistant request failed.");
      setMessages((prev) => prev.slice(0, -1));
      setInput(content);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const content = input.trim();
    if (!content || assistantChat.isPending) return;
    void sendMessage(content);
  };

  const handleTogglePin = (session: ChatSessionListItem) => {
    updateSession.mutate(
      { sessionId: session.id, data: { is_pinned: !session.is_pinned } },
      {
        onSuccess: () => toast.success(session.is_pinned ? "Unpinned." : "Chat pinned."),
        onError: () => toast.error("Failed to update."),
      }
    );
    setMenuAnchor(null);
  };

  const startRename = (session: ChatSessionListItem) => {
    setRenamingId(session.id);
    setRenameValue(session.title ?? "");
    setMenuAnchor(null);
  };

  const commitRename = (sessionId: string) => {
    const title = renameValue.trim() || null;
    updateSession.mutate(
      { sessionId, data: { title } },
      { onError: () => toast.error("Failed to rename.") }
    );
    setRenamingId(null);
    if (sessionId === activeSessionId) setSessionTitle(title);
  };

  const handleDelete = (session: ChatSessionListItem) => {
    setMenuAnchor(null);
    deleteSession.mutate(session.id, {
      onSuccess: () => {
        toast.success("Chat deleted.");
        if (session.id === activeSessionId) {
          setActiveSessionId(null);
          setMessages([]);
          setSessionTitle(null);
        }
      },
      onError: () => toast.error("Failed to delete."),
    });
  };

  const handleExport = (session: ChatSessionListItem) => {
    setMenuAnchor(null);
    exportChat.mutate(session.id, {
      onSuccess: () =>
        toast.success("Saved to Documents › Discussion with Assistant."),
      onError: () => toast.error("Export failed."),
    });
  };

  // ── Sub-components ───────────────────────────────────

  const SectionLabel = ({ label }: { label: string }) => (
    <Typography
      variant="caption"
      color="text.secondary"
      sx={{
        display: "block",
        px: 1.5,
        pt: 1.5,
        pb: 0.25,
        fontWeight: 700,
        fontSize: "0.62rem",
        letterSpacing: "0.07em",
        textTransform: "uppercase",
      }}
    >
      {label}
    </Typography>
  );

  const SessionItem = ({ session }: { session: ChatSessionListItem }) => {
    const isActive = session.id === activeSessionId;
    const isRenaming = renamingId === session.id;

    return (
      <ListItem
        disablePadding
        secondaryAction={
          <IconButton
            size="small"
            className="session-menu-btn"
            onClick={(e) => {
              e.stopPropagation();
              setMenuAnchor(e.currentTarget);
              setMenuSession(session);
            }}
          >
            <MoreVertIcon sx={{ fontSize: 16 }} />
          </IconButton>
        }
        sx={{
          "& .session-menu-btn": { opacity: 0 },
          "&:hover .session-menu-btn": { opacity: 1 },
          ...(isActive && { "& .session-menu-btn": { opacity: 1 } }),
        }}
      >
        <ListItemButton
          selected={isActive}
          onClick={() => void handleSelectSession(session)}
          sx={{ borderRadius: 1.5, pr: 4.5, py: 0.75, "&.Mui-selected": { bgcolor: "action.selected" } }}
        >
          <Box sx={{ minWidth: 0, width: "100%" }}>
            {isRenaming ? (
              <TextField
                autoFocus
                size="small"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => commitRename(session.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename(session.id);
                  if (e.key === "Escape") setRenamingId(null);
                }}
                onClick={(e) => e.stopPropagation()}
                fullWidth
                variant="standard"
                inputProps={{ maxLength: 200 }}
                sx={{ "& input": { fontSize: "0.83rem" } }}
              />
            ) : (
              <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", minWidth: 0 }}>
                {session.is_pinned && (
                  <PushPinIcon sx={{ fontSize: 11, color: "primary.main", flexShrink: 0, mb: 0.1 }} />
                )}
                <Typography
                  variant="body2"
                  noWrap
                  sx={{ fontWeight: isActive ? 600 : 400, fontSize: "0.83rem", flex: 1, minWidth: 0 }}
                >
                  {session.title ?? "New Chat"}
                </Typography>
              </Stack>
            )}
            <Stack direction="row" spacing={0.5} sx={{ mt: 0.2, alignItems: "center" }}>
              <Typography
                variant="caption"
                color="text.secondary"
                noWrap
                sx={{ flex: 1, minWidth: 0, fontSize: "0.7rem" }}
              >
                {session.preview ?? "Empty chat"}
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ flexShrink: 0, fontSize: "0.65rem" }}
              >
                {formatRelativeDate(session.last_message_at ?? session.created_at)}
              </Typography>
            </Stack>
          </Box>
        </ListItemButton>
      </ListItem>
    );
  };

  // ── Shared input bar ─────────────────────────────────
  const InputBar = () => (
    <Box
      component="form"
      onSubmit={handleSubmit}
      sx={{ p: 2, borderTop: 1, borderColor: "divider", bgcolor: "background.default" }}
    >
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "flex-end" }}>
        <TextField
          fullWidth
          multiline
          maxRows={4}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your case, documents, duplicates…"
          variant="outlined"
          size="small"
          sx={{ "& .MuiOutlinedInput-root": { borderRadius: 2, bgcolor: "background.paper" } }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (canSend) void sendMessage(input.trim());
            }
          }}
        />
        <Button
          type="submit"
          variant="contained"
          disabled={!canSend}
          sx={{ borderRadius: 2, py: 1.25, px: 2.5, flexShrink: 0 }}
          endIcon={<SendIcon />}
        >
          Send
        </Button>
      </Stack>
    </Box>
  );

  // ── Layout ───────────────────────────────────────────
  return (
    <Box sx={{ display: "flex", height: "calc(100vh - 120px)", overflow: "hidden" }}>

      {/* ── Sidebar ── */}
      <Box
        sx={{
          width: 272,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          borderRight: 1,
          borderColor: "divider",
          bgcolor: "background.default",
          overflow: "hidden",
        }}
      >
        {/* New Chat */}
        <Box sx={{ p: 1.5, pb: 1 }}>
          <Button
            fullWidth
            variant="contained"
            size="small"
            startIcon={<AddCommentIcon />}
            onClick={handleNewChat}
            sx={{ borderRadius: 2, textTransform: "none" }}
          >
            New Chat
          </Button>
        </Box>

        {/* Search */}
        <Box sx={{ px: 1.5, pb: 1 }}>
          <TextField
            fullWidth
            size="small"
            placeholder="Search chats…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ fontSize: 16, color: "text.secondary" }} />
                </InputAdornment>
              ),
            }}
            sx={{
              "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: "0.8rem" },
              "& input": { fontSize: "0.8rem", py: "6px" },
            }}
          />
        </Box>

        <Divider />

        {/* Session list */}
        <Box sx={{ flex: 1, overflowY: "auto" }}>
          {sessionsList.isLoading ? (
            <Box sx={{ display: "flex", justifyContent: "center", pt: 5 }}>
              <CircularProgress size={22} />
            </Box>
          ) : filteredSessions.length === 0 ? (
            <Box sx={{ px: 2, pt: 5, textAlign: "center" }}>
              <ChatBubbleOutlineIcon sx={{ color: "text.disabled", fontSize: 36, mb: 1 }} />
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: "0.8rem" }}>
                {debouncedSearch
                  ? "No chats match your search."
                  : "No chat history yet.\nStart a new conversation!"}
              </Typography>
            </Box>
          ) : (
            <List dense disablePadding sx={{ pb: 2, px: 0.5 }}>
              {grouped.pinned.length > 0 && (
                <>
                  <SectionLabel label="Pinned" />
                  {grouped.pinned.map((s) => <SessionItem key={s.id} session={s} />)}
                </>
              )}
              {grouped.today.length > 0 && (
                <>
                  <SectionLabel label="Today" />
                  {grouped.today.map((s) => <SessionItem key={s.id} session={s} />)}
                </>
              )}
              {grouped.yesterday.length > 0 && (
                <>
                  <SectionLabel label="Yesterday" />
                  {grouped.yesterday.map((s) => <SessionItem key={s.id} session={s} />)}
                </>
              )}
              {grouped.lastWeek.length > 0 && (
                <>
                  <SectionLabel label="Last 7 Days" />
                  {grouped.lastWeek.map((s) => <SessionItem key={s.id} session={s} />)}
                </>
              )}
              {grouped.older.length > 0 && (
                <>
                  <SectionLabel label="Older" />
                  {grouped.older.map((s) => <SessionItem key={s.id} session={s} />)}
                </>
              )}
            </List>
          )}
        </Box>
      </Box>

      {/* ── Kebab context menu ── */}
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={() => setMenuAnchor(null)}
        PaperProps={{ sx: { minWidth: 190 } }}
        transformOrigin={{ horizontal: "right", vertical: "top" }}
        anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
      >
        {menuSession && [
          <MenuItem key="rename" onClick={() => startRename(menuSession)}>
            <EditOutlinedIcon fontSize="small" sx={{ mr: 1.5, color: "text.secondary" }} />
            Rename
          </MenuItem>,
          <MenuItem key="pin" onClick={() => handleTogglePin(menuSession)}>
            {menuSession.is_pinned ? (
              <>
                <PushPinOutlinedIcon fontSize="small" sx={{ mr: 1.5, color: "text.secondary" }} />
                Unpin
              </>
            ) : (
              <>
                <PushPinIcon fontSize="small" sx={{ mr: 1.5, color: "text.secondary" }} />
                Pin
              </>
            )}
          </MenuItem>,
          <MenuItem key="export" onClick={() => handleExport(menuSession)}>
            <FileDownloadIcon fontSize="small" sx={{ mr: 1.5, color: "text.secondary" }} />
            Send to Documents
          </MenuItem>,
          <Divider key="div" />,
          <MenuItem
            key="delete"
            onClick={() => handleDelete(menuSession)}
            sx={{ color: "error.main" }}
          >
            <DeleteOutlineIcon fontSize="small" sx={{ mr: 1.5 }} />
            Delete Chat
          </MenuItem>,
        ]}
      </Menu>

      {/* ── Main chat panel ── */}
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", p: 2 }}>

        {!activeSessionId && messages.length === 0 ? (

          // ── Welcome / empty state ──
          <Paper sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }} elevation={2}>
            <Box sx={{ p: 3, borderBottom: 1, borderColor: "divider" }}>
              <Typography variant="overline" color="text.secondary" sx={{ fontWeight: "bold" }}>
                Case Assistant
              </Typography>
              <Typography variant="h5" sx={{ fontWeight: "bold", mt: 0.5 }}>
                Chat With Your Documents
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Ask questions, organize your files, search for topics, or surface duplicates.
                Every conversation is saved automatically.
              </Typography>
            </Box>

            <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", p: 4 }}>
              <Box sx={{ maxWidth: 460, width: "100%" }}>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mb: 2.5, textAlign: "center" }}
                >
                  Try one of these to get started:
                </Typography>
                <Stack spacing={1.5}>
                  {STARTER_PROMPTS.map((prompt) => (
                    <Button
                      key={prompt}
                      variant="outlined"
                      fullWidth
                      onClick={() => void sendMessage(prompt)}
                      disabled={assistantChat.isPending}
                      sx={{
                        borderRadius: 2,
                        textAlign: "left",
                        justifyContent: "flex-start",
                        textTransform: "none",
                        py: 1.25,
                        fontSize: "0.88rem",
                      }}
                    >
                      {prompt}
                    </Button>
                  ))}
                </Stack>

                {/* Tools chips */}
                <Box sx={{ mt: 4, display: "flex", flexWrap: "wrap", gap: 0.75, justifyContent: "center" }}>
                  {["Organize documents", "Semantic search", "Scan duplicates", "List documents"].map(
                    (t) => <Chip key={t} label={t} size="small" variant="outlined" />
                  )}
                </Box>
              </Box>
            </Box>

            <InputBar />
          </Paper>

        ) : (

          // ── Active chat ──
          <Paper sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }} elevation={2}>

            {/* Header */}
            <Box
              sx={{
                px: 3,
                py: 1.75,
                borderBottom: 1,
                borderColor: "divider",
                display: "flex",
                alignItems: "center",
                gap: 1,
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="subtitle1" fontWeight={600} noWrap>
                  {sessionTitle ?? "New Chat"}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {messages.filter((m) => m.role === "user").length} message
                  {messages.filter((m) => m.role === "user").length !== 1 ? "s" : ""}
                </Typography>
              </Box>

              {/* Header action buttons if we have a real session */}
              {activeSessionId && (() => {
                const cur = allSessions.find((s) => s.id === activeSessionId);
                if (!cur) return null;
                return (
                  <Stack direction="row" spacing={0.25}>
                    <Tooltip title={cur.is_pinned ? "Unpin chat" : "Pin chat"}>
                      <IconButton size="small" onClick={() => handleTogglePin(cur)}>
                        {cur.is_pinned
                          ? <PushPinIcon fontSize="small" color="primary" />
                          : <PushPinOutlinedIcon fontSize="small" />}
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Send to Documents">
                      <IconButton size="small" onClick={() => handleExport(cur)}>
                        <FileDownloadIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="More options">
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          setMenuAnchor(e.currentTarget);
                          setMenuSession(cur);
                        }}
                      >
                        <MoreVertIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                );
              })()}
            </Box>

            {/* Messages */}
            <Box
              sx={{
                flex: 1,
                overflowY: "auto",
                p: 3,
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              {messages.map((message, index) => (
                <Box
                  key={`${message.role}-${index}`}
                  sx={{
                    alignSelf: message.role === "user" ? "flex-end" : "flex-start",
                    maxWidth: "85%",
                    bgcolor:
                      message.role === "user" ? "primary.main" : "background.paper",
                    color:
                      message.role === "user"
                        ? "primary.contrastText"
                        : "text.primary",
                    border: message.role !== "user" ? 1 : 0,
                    borderColor: "divider",
                    borderRadius: 3,
                    p: 2,
                    boxShadow: message.role === "user" ? 2 : 0,
                  }}
                >
                  <Typography
                    variant="body2"
                    sx={{ whiteSpace: "pre-wrap", lineHeight: 1.65 }}
                  >
                    {message.content}
                  </Typography>
                </Box>
              ))}

              {assistantChat.isPending && (
                <Box
                  sx={{
                    alignSelf: "flex-start",
                    maxWidth: "85%",
                    bgcolor: "background.paper",
                    border: 1,
                    borderColor: "divider",
                    borderRadius: 3,
                    p: 2,
                  }}
                >
                  <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                    <CircularProgress size={14} />
                    <Typography variant="body2" color="text.secondary">
                      Thinking…
                    </Typography>
                  </Stack>
                </Box>
              )}

              <div ref={messagesEndRef} />
            </Box>

            <InputBar />
          </Paper>
        )}
      </Box>
    </Box>
  );
}
