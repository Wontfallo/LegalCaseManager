"use client";

import { useEffect, useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  Box, Typography, Button, TextField, Select, MenuItem, Stack, Paper, IconButton, CircularProgress,
  Accordion, AccordionSummary, AccordionDetails, Card, CardContent, Checkbox, Chip, Dialog,
  DialogTitle, DialogContent, DialogActions, Grid, Menu
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import FolderIcon from "@mui/icons-material/Folder";
import CloseIcon from "@mui/icons-material/Close";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import UnfoldMoreIcon from "@mui/icons-material/UnfoldMore";
import UnfoldLessIcon from "@mui/icons-material/UnfoldLess";
import {
  useAIOrganizeDocuments,
  useCleanupDuplicateDocuments,
  useCaseDocuments,
  useDeleteDocument,
  useDocumentDuplicates,
  useReOCRAll,
  useResummarizeAll,
  useResummarizeDocument,
  useRetryDocument,
  useScanImages,
  useUpdateDocumentOrganization,
  useUploadDocument,
  useGoogleStatus,
  useGoogleConnect,
  useBackupToDrive,
} from "@/hooks/useApi";
import { apiClient } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";
import type { DocStatus, DocumentResponse, DuplicateGroup } from "@/types";

const fadeIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.2 },
};

const slideUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 20 },
  transition: { duration: 0.3, ease: 'easeOut' as const },
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05, delayChildren: 0.05 },
  },
};

const staggerItem = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.2, ease: 'easeOut' as const } },
};

interface Props {
  caseId: string;
}

function StatusBadge({ status }: { status: DocStatus }) {
  const styles: Record<DocStatus, string> = {
    pending: "bg-white/10 text-white border border-white/20",
    processing: "bg-[#F59E0B]/20 text-[#F59E0B] border border-[#F59E0B]/30 animate-pulse shadow-[0_0_10px_rgba(245,158,11,0.2)]",
    completed: "bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/20 shadow-[0_0_10px_rgba(16,185,129,0.1)]",
    failed: "bg-[#EF4444]/10 text-[#EF4444] border border-[#EF4444]/20 shadow-[0_0_10px_rgba(239,68,68,0.1)]",
  };
  const labels: Record<DocStatus, string> = {
    pending: "Pending",
    processing: "Processing",
    completed: "Completed",
    failed: "Failed",
  };
  return (
    <span
      className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider backdrop-blur-sm ${styles[status]}`}
    >
      {labels[status]}
    </span>
  );
}

const getSectionDescription = (name: string) => {
  const norm = name.toLowerCase();
  
  if (norm.includes("contract") || norm.includes("agreement")) return "Legally binding agreements and signed covenants.";
  if (norm.includes("board meeting") || norm.includes("minutes")) return "Official records and corporate board meeting details.";
  if (norm.includes("financial") || norm.includes("accounting") || norm.includes("bank") || norm.includes("receipt") || norm.includes("invoice")) return "Ledgers, accounting records, tax documents, and fiscal reports.";
  if (norm.includes("email") || norm.includes("correspondence") || norm.includes("letter")) return "Electronic communications, letters, and correspondences.";
  if (norm.includes("evidence") || norm.includes("photo") || norm.includes("video")) return "Exhibits, photographic records, and raw evidentiary artifacts.";
  if (norm.includes("governing") || norm.includes("bylaws")) return "Foundational corporate records and operating agreements.";
  if (norm.includes("medical") || norm.includes("health")) return "Medical records, bills, and provider documentation.";
  if (norm.includes("court") || norm.includes("pleading") || norm.includes("filing")) return "Official court filings, pleadings, and docket records.";
  if (norm.includes("police") || norm.includes("accident")) return "Law enforcement reports and accident documentation.";
  if (norm.includes("ungrouped") || norm.includes("general")) return "Uncategorized or miscellaneous case files.";
  
  return "Collection of organized legal case documents and related files.";
};

const STANDARD_SECTIONS = [
  "Governing Documents",
  "Board Meetings Agenda & Minutes",
  "Contracts",
  "Letters from Lawfirm",
  "Reports and Bids",
  "Emails (Lefky Law Firm)",
  "Emails",
  "Receipts USPS",
  "Correspondence",
  "Financials",
  "Photos and Evidence",
  "General",
];

export default function DocumentsTab({ caseId }: Props) {
  const queryClient = useQueryClient();
  const expandedSectionsStorageKey = `legalcm:documents:${caseId}:expanded-sections`;
  const { data: documents, isLoading } = useCaseDocuments(caseId);
  const { data: duplicateScan, isLoading: duplicatesLoading } =
    useDocumentDuplicates(caseId);
  const uploadMutation = useUploadDocument(caseId);
  const deleteMutation = useDeleteDocument(caseId);
  const retryMutation = useRetryDocument(caseId);
  const cleanupDuplicatesMutation = useCleanupDuplicateDocuments(caseId);
  const updateOrganizationMutation = useUpdateDocumentOrganization(caseId);
  const aiOrganizeMutation = useAIOrganizeDocuments(caseId);
  const resummarizeDocMutation = useResummarizeDocument(caseId);
  const resummarizeAllMutation = useResummarizeAll(caseId);
  const reOCRAllMutation = useReOCRAll(caseId);
  const scanImagesMutation = useScanImages(caseId);
  const { data: googleStatus } = useGoogleStatus();
  const googleConnectMutation = useGoogleConnect();
  const backupToDriveMutation = useBackupToDrive(caseId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [compareDocId, setCompareDocId] = useState<string | null>(null);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [selectedDuplicateIds, setSelectedDuplicateIds] = useState<string[]>([]);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [newSectionName, setNewSectionName] = useState("");
  const [bulkTargetSection, setBulkTargetSection] = useState("Ungrouped");
  const [draggingDocId, setDraggingDocId] = useState<string | null>(null);
  const [actionsAnchorEl, setActionsAnchorEl] = useState<null | HTMLElement>(null);

  const groupedDocuments = (documents || []).reduce<Record<string, DocumentResponse[]>>(
    (acc, doc) => {
      const key = doc.section_label?.trim() || "Ungrouped";
      if (!acc[key]) acc[key] = [];
      acc[key].push(doc);
      return acc;
    },
    {}
  );

  const sectionEntries = Object.entries(groupedDocuments).map(([section, docs]) => [
    section,
    [...docs].sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at)),
  ] as const);
  const allSectionNames = Array.from(
    new Set(["Ungrouped", ...sectionEntries.map(([section]) => section)])
  );
  
  const allSectionsExpanded = allSectionNames.length > 0 && allSectionNames.every(name => expandedSections[name]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = window.localStorage.getItem(expandedSectionsStorageKey);
      if (!saved) return;
      const parsed = JSON.parse(saved) as Record<string, boolean>;
      setExpandedSections(parsed);
    } catch {
      window.localStorage.removeItem(expandedSectionsStorageKey);
    }
  }, [expandedSectionsStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      expandedSectionsStorageKey,
      JSON.stringify(expandedSections)
    );
  }, [expandedSections, expandedSectionsStorageKey]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const validFiles = files; // Accept all formats naturally

    try {
      setUploadingCount(validFiles.length);
      let uploadedCount = 0;
      let duplicateCount = 0;
      for (const file of validFiles) {
        const result = await uploadMutation.mutateAsync(file);
        if (result.duplicate) {
          duplicateCount += 1;
          toast.error(`${file.name}: ${result.message}`);
        } else {
          uploadedCount += 1;
        }
      }
      if (uploadedCount > 0) {
        toast.success(
          `${uploadedCount} document${uploadedCount === 1 ? "" : "s"} uploaded. OCR processing started.`
        );
      }
      if (duplicateCount > 0 && uploadedCount === 0) {
        toast.error("All selected files were already in this case.");
      }
    } catch (err: any) {
      toast.error(
        err?.response?.data?.detail || "Failed to upload document."
      );
    } finally {
      setUploadingCount(0);
    }

    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const selectedDoc = documents?.find((d) => d.id === selectedDocId);
  const compareDoc = documents?.find((d) => d.id === compareDocId);

  const handleDeleteDocument = async (documentId: string, filename: string) => {
    if (!window.confirm(`Delete document "${filename}"?`)) {
      return;
    }

    try {
      await deleteMutation.mutateAsync(documentId);
      if (selectedDocId === documentId) {
        setSelectedDocId(null);
      }
      toast.success("Document deleted.");
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Failed to delete document.");
    }
  };

  const handleRetryDocument = async (documentId: string) => {
    try {
      await retryMutation.mutateAsync(documentId);
      toast.success("Document re-queued for OCR.");
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Failed to retry document OCR.");
    }
  };

  const toggleSectionExpanded = (sectionName: string) => {
    setExpandedSections((current) => ({
      ...current,
      [sectionName]: !current[sectionName],
    }));
  };

  const toggleDocumentSelection = (documentId: string) => {
    setSelectedDocumentIds((current) =>
      current.includes(documentId)
        ? current.filter((id) => id !== documentId)
        : [...current, documentId]
    );
  };

  const toggleDuplicateSelection = (documentId: string) => {
    setSelectedDuplicateIds((current) =>
      current.includes(documentId)
        ? current.filter((id) => id !== documentId)
        : [...current, documentId]
    );
  };

  const handleOpenDuplicate = (documentId: string) => {
    setSelectedDocId(documentId);
    setCompareDocId(null);
  };

  const handleCompareDuplicate = (_documentId: string, group?: { documents: { document_id: string }[] }) => {
    if (group && group.documents.length >= 2) {
      // Always: first doc (top) = left, second doc (bottom) = right
      setSelectedDocId(group.documents[0].document_id);
      setCompareDocId(group.documents[1].document_id);
      return;
    }
  };

  const handleDeleteSelectedDuplicates = async () => {
    if (selectedDuplicateIds.length === 0) {
      toast.error("Select duplicate documents to delete.");
      return;
    }
    if (
      !window.confirm(
        `Delete ${selectedDuplicateIds.length} selected duplicate document${selectedDuplicateIds.length === 1 ? "" : "s"}?`
      )
    ) {
      return;
    }
    try {
      await cleanupDuplicatesMutation.mutateAsync({
        case_id: caseId,
        document_ids: selectedDuplicateIds,
        keep_document_id: null,
      });
      setSelectedDuplicateIds([]);
      if (selectedDocId && selectedDuplicateIds.includes(selectedDocId)) {
        setSelectedDocId(null);
      }
      if (compareDocId && selectedDuplicateIds.includes(compareDocId)) {
        setCompareDocId(null);
      }
      toast.success("Selected duplicate documents deleted.");
    } catch (err: any) {
      toast.error(
        err?.response?.data?.detail || "Failed to delete duplicate documents."
      );
    }
  };

  const handleKeepOneFromGroup = async (
    group: DuplicateGroup,
    keepDocumentId: string
  ) => {
    const documentIds = group.documents.map((doc) => doc.document_id);
    const deleteIds = documentIds.filter((id) => id !== keepDocumentId);
    if (deleteIds.length === 0) return;
    if (
      !window.confirm(
        `Keep one document and delete ${deleteIds.length} duplicate${deleteIds.length === 1 ? "" : "s"} from this group?`
      )
    ) {
      return;
    }
    try {
      await cleanupDuplicatesMutation.mutateAsync({
        case_id: caseId,
        document_ids: deleteIds,
        keep_document_id: keepDocumentId,
      });
      setSelectedDuplicateIds((current) =>
        current.filter((id) => !deleteIds.includes(id))
      );
      if (selectedDocId && deleteIds.includes(selectedDocId)) {
        setSelectedDocId(keepDocumentId);
      }
      if (compareDocId && deleteIds.includes(compareDocId)) {
        setCompareDocId(null);
      }
      toast.success("Duplicate group cleaned up.");
    } catch (err: any) {
      toast.error(
        err?.response?.data?.detail || "Failed to clean up duplicate group."
      );
    }
  };

  const renderDocumentPreview = (doc: DocumentResponse, title: string) => (
    <Card variant="outlined" sx={{ mb: 3 }}>
      <CardContent>
        <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "flex-start", mb: 3 }}>
          <Box>
            <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
              <Typography variant="h6" color="primary" sx={{ fontWeight: "bold" }}>
                {doc.display_title || doc.original_filename}
              </Typography>
              <StatusBadge status={doc.status} />
            </Stack>
            {doc.display_title && doc.original_filename && (
              <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.5, fontStyle: 'italic' }}>
                File: {doc.original_filename}
              </Typography>
            )}
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {title} | Type: <Box component="span" sx={{ textTransform: "uppercase" }}>{doc.file_type}</Box>
            </Typography>
          </Box>
          <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
            <Button
              size="small"
              onClick={async () => {
                try {
                  const { blob, contentType } = await apiClient.getBlob(`/api/documents/${doc.id}/file`);
                  const fileBlob = contentType && blob.type !== contentType ? new Blob([blob], { type: contentType }) : blob;
                  const objectUrl = URL.createObjectURL(fileBlob);
                  window.open(objectUrl, "_blank", "noopener,noreferrer");
                  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
                } catch (err: any) {
                  toast.error(err?.response?.data?.detail || "Failed to open original document.");
                }
              }}
            >
              Open Original
            </Button>
            <Button
              size="small"
              color="inherit"
              onClick={async () => {
                try {
                  const { blob, filename } = await apiClient.getBlob(`/api/documents/${doc.id}/file`);
                  const objectUrl = URL.createObjectURL(blob);
                  const anchor = document.createElement("a");
                  anchor.href = objectUrl;
                  anchor.download = filename || doc.original_filename || `document-${doc.id}`;
                  document.body.appendChild(anchor);
                  anchor.click();
                  anchor.remove();
                  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
                } catch (err: any) {
                  toast.error(err?.response?.data?.detail || "Failed to download original document.");
                }
              }}
            >
              Download Original
            </Button>
          </Stack>
        </Stack>

        {doc.status === "failed" && (
          <Paper variant="outlined" sx={{ p: 2, bgcolor: 'error.light', color: 'error.contrastText', mb: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: "bold" }}>Processing Failed</Typography>
            <Typography variant="body2">{doc.status_message || "An unknown error occurred during processing."}</Typography>
          </Paper>
        )}

        {(doc.status === "pending" || doc.status === "processing") && (
          <Paper variant="outlined" sx={{ p: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 2 }}>
            <CircularProgress size={32} sx={{ mb: 2 }} />
            <Typography variant="body2" color="text.secondary">
              {doc.status_message || "OCR processing in progress..."}
            </Typography>
          </Paper>
        )}

        {doc.status === "completed" && (
          <Stack spacing={3}>
            {doc.summary && (
              <Box>
                <Typography variant="subtitle2" color="primary" sx={{ mb: 1, textTransform: 'uppercase', fontWeight: "bold" }}>
                  AI Summary
                </Typography>
                <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
                  {doc.summary}
                </Typography>
              </Box>
            )}
            {doc.raw_ocr_text ? (
              <Box>
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1, textTransform: 'uppercase', fontWeight: "bold" }}>
                  Extracted Text
                </Typography>
                <Paper variant="outlined" sx={{ p: 2, maxHeight: '50vh', overflowY: 'auto' }}>
                  <Typography variant="body2" component="pre" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                    {doc.raw_ocr_text}
                  </Typography>
                </Paper>
              </Box>
            ) : (
              <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  No text was extracted from this document.
                </Typography>
              </Paper>
            )}
          </Stack>
        )}
      </CardContent>
    </Card>
  );

  const saveDocumentPlacement = async (
    document: DocumentResponse,
    sectionLabel: string | null,
    sortOrder: number
  ) => {
    try {
      await updateOrganizationMutation.mutateAsync({
        case_id: caseId,
        documents: [
          {
            document_id: document.id,
            section_label: sectionLabel,
            sort_order: sortOrder,
          },
        ],
      });
      const targetLabel = sectionLabel || "Ungrouped";
      const currentLabel = document.section_label || "Ungrouped";
      if (targetLabel !== currentLabel) {
        // Auto-expand the target section so the document is visible after the move
        setExpandedSections(prev => ({ ...prev, [targetLabel]: true }));
        toast.success(`Moved to "${targetLabel}".`);
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Failed to reorganize document.");
    }
  };

  const handleBulkMove = async () => {
    if (selectedDocumentIds.length === 0) {
      toast.error("Select documents to move.");
      return;
    }
    const targetSection = bulkTargetSection === "Ungrouped" ? null : bulkTargetSection.trim();
    const selectedDocs = (documents || []).filter((doc) => selectedDocumentIds.includes(doc.id));
    try {
      await updateOrganizationMutation.mutateAsync({
        case_id: caseId,
        documents: selectedDocs.map((doc, index) => ({
          document_id: doc.id,
          section_label: targetSection,
          sort_order: index,
        })),
      });
      toast.success(`Moved ${selectedDocs.length} document${selectedDocs.length === 1 ? "" : "s"}.`);
      setSelectedDocumentIds([]);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Failed to bulk move documents.");
    }
  };

  const handleCreateSection = async () => {
    const sectionName = newSectionName.trim();
    if (!sectionName) {
      toast.error("Enter a section name.");
      return;
    }
    setBulkTargetSection(sectionName);
    setNewSectionName("");
    setExpandedSections((current) => ({ ...current, [sectionName]: true }));
    toast.success(`Section "${sectionName}" created.`);
  };

  const handleRenameSection = async (oldName: string) => {
    const nextName = window.prompt("Rename section", oldName)?.trim();
    if (!nextName || nextName === oldName) return;
    const sectionDocs = (documents || []).filter(
      (doc) => (doc.section_label?.trim() || "Ungrouped") === oldName
    );
    try {
      await updateOrganizationMutation.mutateAsync({
        case_id: caseId,
        documents: sectionDocs.map((doc) => ({
          document_id: doc.id,
          section_label: nextName === "Ungrouped" ? null : nextName,
          sort_order: doc.sort_order,
        })),
      });
      toast.success(`Renamed section to "${nextName}".`);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Failed to rename section.");
    }
  };

  const handleDropDocument = async (
    droppedDocId: string,
    targetSection: string,
    targetIndex: number
  ) => {
    if (!documents) return;
    const draggedDoc = documents.find((doc) => doc.id === droppedDocId);
    if (!draggedDoc) return;

    const targetDocs = documents
      .filter((doc) => (doc.section_label?.trim() || "Ungrouped") === targetSection)
      .filter((doc) => doc.id !== droppedDocId)
      .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));

    const nextDocs = [...targetDocs];
    nextDocs.splice(targetIndex, 0, draggedDoc);

    try {
      await updateOrganizationMutation.mutateAsync({
        case_id: caseId,
        documents: nextDocs.map((doc, index) => ({
          document_id: doc.id,
          section_label: targetSection === "Ungrouped" ? null : targetSection,
          sort_order: index,
        })),
      });
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Failed to move document.");
    } finally {
      setDraggingDocId(null);
    }
  };

  return (
    <Box sx={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Documents List */}
      <Box
        sx={{
          width: selectedDoc ? "50%" : "100%",
          borderRight: 1,
          borderColor: "divider",
          bgcolor: "background.paper",
          overflowY: "auto",
          transition: "width 0.3s ease",
        }}
      >
        <Box sx={{ px: 4, py: 4, maxWidth: "xl", mx: "auto" }}>
          <Stack 
            direction={{ xs: 'column', xl: 'row' }} 
            spacing={3} 
            sx={{ 
              alignItems: { xl: 'center' }, 
              justifyContent: "space-between", 
              mb: 4, 
              pb: 3, 
              borderBottom: 1, 
              borderColor: 'divider',
              minHeight: 72
            }}
          >
            <Box>
              <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
                <Typography variant="h5" sx={{ fontWeight: "bold" }}>
                  Documents
                </Typography>
                <Chip
                  label={documents?.length || 0}
                  size="small"
                  color="primary"
                  variant="outlined"
                  sx={{ fontWeight: "bold" }}
                />
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Upload case files, documents, or images. Use AI Organize to auto-categorize.
              </Typography>
            </Box>

            {selectedDocumentIds.length > 0 ? (
              <Stack direction="row" spacing={2} sx={{ alignItems: "center", bgcolor: 'primary.dark', p: 1.5, borderRadius: 2 }}>
                <Typography variant="subtitle2" sx={{ color: 'primary.contrastText', mr: 2, fontWeight: 'bold' }}>
                  {selectedDocumentIds.length} Selected
                </Typography>
                <TextField
                  select
                  size="small"
                  value={bulkTargetSection}
                  onChange={(e) => setBulkTargetSection(e.target.value)}
                  sx={{ width: 160, bgcolor: 'background.paper', borderRadius: 1, '& .MuiOutlinedInput-notchedOutline': { border: 'none' } }}
                >
                  {Array.from(new Set(["Ungrouped", ...STANDARD_SECTIONS, ...sectionEntries.map(([name]) => name)])).map((name) => (
                    <MenuItem key={name} value={name}>
                      {name}
                    </MenuItem>
                  ))}
                </TextField>
                <Button
                  variant="contained"
                  color="primary"
                  size="small"
                  onClick={() => void handleBulkMove()}
                >
                  Move
                </Button>
                <Button
                  variant="outlined"
                  color="inherit"
                  size="small"
                  onClick={() => setSelectedDocumentIds([])}
                  sx={{ color: 'white', borderColor: 'rgba(255,255,255,0.3)' }}
                >
                  Clear Selection
                </Button>
              </Stack>
            ) : (
              <Stack direction="row" spacing={1.5} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap", justifyContent: { xs: "flex-start", xl: "flex-end" } }}>
                 <Stack direction="row" spacing={1} sx={{ mr: { md: 2 }, pr: { md: 2 }, borderRight: { md: 1 }, borderColor: 'divider', alignItems: 'center' }}>
                   <TextField
                     size="small"
                     value={newSectionName}
                     onChange={(e) => setNewSectionName(e.target.value)}
                     placeholder="New section..."
                     sx={{ width: { xs: 140, sm: 180 } }}
                   />
                   <Button 
                     variant="outlined" 
                     size="small" 
                     onClick={() => void handleCreateSection()} 
                     disabled={!newSectionName.trim()}
                     sx={{ whiteSpace: 'nowrap', minWidth: 'min-content' }}
                   >
                     Add
                   </Button>
                 </Stack>

                <Button
                  variant="contained"
                  color="secondary"
                  onClick={async () => {
                    try {
                      const result = await aiOrganizeMutation.mutateAsync();
                      toast.success(
                        `AI organized ${result.documents.length} document${result.documents.length === 1 ? "" : "s"}.`
                      );
                    } catch (err: any) {
                      toast.error(
                        err?.response?.data?.detail || "Failed to AI-organize documents."
                      );
                    }
                  }}
                  disabled={aiOrganizeMutation.isPending}
                >
                  {aiOrganizeMutation.isPending ? "Organizing..." : "AI Organize"}
                </Button>

                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={handleUpload}
                  multiple
                  style={{ display: "none" }}
                />
                <Button
                  variant="contained"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadMutation.isPending || uploadingCount > 0}
                >
                  {uploadingCount > 0 ? `Uploading ${uploadingCount}...` : "+ Upload"}
                </Button>

                <IconButton onClick={(e) => setActionsAnchorEl(e.currentTarget)} sx={{ ml: 1, bgcolor: 'action.hover' }}>
                  <MoreVertIcon />
                </IconButton>
                <Menu
                  anchorEl={actionsAnchorEl}
                  open={Boolean(actionsAnchorEl)}
                  onClose={() => setActionsAnchorEl(null)}
                  transformOrigin={{ horizontal: 'right', vertical: 'top' }}
                  anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
                >
                  <MenuItem onClick={async () => {
                    setActionsAnchorEl(null);
                    try {
                      await queryClient.invalidateQueries({
                        queryKey: ["cases", caseId, "document-duplicates"],
                      });
                      setShowDuplicates(true);
                    } catch (e) {
                      console.error(e);
                    }
                  }}>
                    {showDuplicates ? "Refresh Duplicates" : "Scan Duplicates"}
                  </MenuItem>
                  <MenuItem onClick={async () => {
                    setActionsAnchorEl(null);
                    try {
                      const result = await resummarizeAllMutation.mutateAsync();
                      toast.success(result.message);
                    } catch (err: any) {
                      toast.error(err?.response?.data?.detail || "Failed to re-summarize.");
                    }
                  }} disabled={resummarizeAllMutation.isPending}>
                    Re-summarize All
                  </MenuItem>
                  <MenuItem onClick={async () => {
                    setActionsAnchorEl(null);
                    try {
                      const result = await scanImagesMutation.mutateAsync();
                      toast.success(result.message);
                    } catch (err: any) {
                      toast.error(err?.response?.data?.detail || "No images found or scan failed.");
                    }
                  }} disabled={scanImagesMutation.isPending}>
                    Scan Images (Vision)
                  </MenuItem>

                  <MenuItem 
                    onClick={async () => {
                      setActionsAnchorEl(null);
                      if (googleStatus?.connected) {
                        try {
                          const result = await backupToDriveMutation.mutateAsync();
                          toast.success(result.message);
                        } catch (err: any) {
                          toast.error(err?.response?.data?.detail || "Backup failed.");
                        }
                      } else {
                        try {
                          const result = await googleConnectMutation.mutateAsync();
                          window.location.href = result.url;
                        } catch (err: any) {
                          toast.error("Failed to start Google connection.");
                        }
                      }
                    }} 
                    disabled={backupToDriveMutation.isPending || googleConnectMutation.isPending}
                  >
                    {googleStatus?.connected ? "Backup to Google Drive" : "Connect Google Account"}
                  </MenuItem>
                  <MenuItem sx={{ color: 'error.main' }} onClick={async () => {
                    setActionsAnchorEl(null);
                    if (!window.confirm("Re-run OCR on ALL documents? This will reprocess everything from scratch.")) return;
                    try {
                      const result = await reOCRAllMutation.mutateAsync();
                      toast.success(result.message);
                    } catch (err: any) {
                      toast.error(err?.response?.data?.detail || "Failed to re-scan.");
                    }
                  }} disabled={reOCRAllMutation.isPending}>
                    Re-scan All (OCR)
                  </MenuItem>
                </Menu>
              </Stack>
            )}
          </Stack>

          {isLoading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
              <CircularProgress />
            </Box>
          ) : !documents || documents.length === 0 ? (
            <Box sx={{ textAlign: "center", py: 6 }}>
              <Typography color="text.secondary">
                No documents yet. Upload one or more PDFs or images to start.
              </Typography>
            </Box>
          ) : (
            <Stack spacing={3}>
              {showDuplicates && duplicateScan && duplicateScan.duplicate_groups.length > 0 && (
                <Paper variant="outlined" sx={{ p: 3, borderColor: 'warning.main', bgcolor: 'warning.light', color: 'warning.contrastText' }}>
                  <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "flex-start", mb: 2 }}>
                    <Box>
                      <Typography variant="subtitle2" sx={{ fontWeight: "bold" }}>
                        Possible Duplicates ({duplicateScan.duplicate_groups.length} groups)
                      </Typography>
                      <Typography variant="caption">
                        Compare documents, then use bulk actions or resolve individually.
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={1}>
                      <Button size="small" variant="outlined" color="inherit" onClick={() => { setShowDuplicates(false); setSelectedDuplicateIds([]); }}>
                        Dismiss
                      </Button>
                      <Button size="small" variant="contained" color="error" disabled={selectedDuplicateIds.length === 0 || cleanupDuplicatesMutation.isPending} onClick={() => void handleDeleteSelectedDuplicates()}>
                        Delete Selected ({selectedDuplicateIds.length})
                      </Button>
                      <Button size="small" variant="contained" color="error" disabled={cleanupDuplicatesMutation.isPending} onClick={async () => {
                          const allDupeIds = duplicateScan.duplicate_groups.flatMap((g) => g.documents.slice(1).map((d) => d.document_id));
                          if (allDupeIds.length === 0) return;
                          if (!window.confirm(`Delete ${allDupeIds.length} duplicates across all groups? The first document in each group will be kept.`)) return;
                          try {
                            await cleanupDuplicatesMutation.mutateAsync({ case_id: caseId, document_ids: allDupeIds, keep_document_id: null });
                            setSelectedDuplicateIds([]);
                            setShowDuplicates(false);
                            toast.success(`Deleted ${allDupeIds.length} duplicates.`);
                          } catch (err: any) {
                            toast.error(err?.response?.data?.detail || "Failed to delete duplicates.");
                          }
                      }}>
                        Delete All Duplicates
                      </Button>
                    </Stack>
                  </Stack>
                  <Stack spacing={2}>
                    {duplicateScan.duplicate_groups.map((group, index) => {
                      const groupDocIds = group.documents.map((d) => d.document_id);
                      const allGroupSelected = groupDocIds.every((id) => selectedDuplicateIds.includes(id));
                      const someGroupSelected = groupDocIds.some((id) => selectedDuplicateIds.includes(id));
                      return (
                        <Paper key={`${group.reason}-${index}`} sx={{ p: 2 }}>
                          <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center", mb: 1 }}>
                            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                              <Checkbox 
                                size="small" 
                                checked={allGroupSelected} 
                                indeterminate={someGroupSelected && !allGroupSelected} 
                                onChange={() => {
                                  if (allGroupSelected) {
                                    setSelectedDuplicateIds((c) => c.filter((id) => !groupDocIds.includes(id)));
                                  } else {
                                    setSelectedDuplicateIds((c) => [...new Set([...c, ...groupDocIds])]);
                                  }
                                }} 
                              />
                              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: "bold", textTransform: "uppercase" }}>
                                {group.reason}
                              </Typography>
                            </Stack>
                            {group.documents.length >= 2 && (
                               <Button size="small" onClick={() => handleCompareDuplicate(group.documents[0].document_id, group)}>
                                 Compare
                               </Button>
                            )}
                          </Stack>
                          <Stack spacing={1}>
                            {group.documents.map((candidate) => (
                              <Paper variant="outlined" key={candidate.document_id} sx={{ p: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 0, flex: 1 }}>
                                  <Checkbox size="small" checked={selectedDuplicateIds.includes(candidate.document_id)} onChange={() => toggleDuplicateSelection(candidate.document_id)} />
                                  <Typography variant="body2" noWrap>
                                    {candidate.original_filename || candidate.document_id}
                                  </Typography>
                                </Stack>
                                <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
                                  <Typography variant="caption" color="text.secondary">
                                    {(candidate.confidence * 100).toFixed(0)}% match
                                  </Typography>
                                  <Button size="small" onClick={() => handleOpenDuplicate(candidate.document_id)}>Open</Button>
                                  <Button size="small" color="success" onClick={() => void handleKeepOneFromGroup(group, candidate.document_id)}>Keep This</Button>
                                </Stack>
                              </Paper>
                            ))}
                          </Stack>
                        </Paper>
                      );
                    })}
                  </Stack>
                </Paper>
              )}

              {showDuplicates && duplicateScan && duplicateScan.duplicate_groups.length === 0 && (
                <Paper variant="outlined" sx={{ p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography variant="body2" color="text.secondary">No duplicate groups found.</Typography>
                  <Button size="small" onClick={() => setShowDuplicates(false)}>Dismiss</Button>
                </Paper>
              )}

              {sectionEntries.length > 0 && (
                <Stack direction="row" spacing={2} sx={{ justifyContent: "flex-end", mb: 2 }}>
                  <Button 
                    size="small" 
                    color="inherit"
                    startIcon={allSectionsExpanded ? <UnfoldLessIcon /> : <UnfoldMoreIcon />}
                    onClick={() => {
                      if (allSectionsExpanded) {
                        setExpandedSections({});
                      } else {
                        setExpandedSections(allSectionNames.reduce((acc, name) => ({ ...acc, [name]: true }), {}));
                      }
                    }}
                  >
                    {allSectionsExpanded ? "Collapse All" : "Expand All"}
                  </Button>
                </Stack>
              )}

              {sectionEntries.map(([sectionName, sectionDocs]) => (
                <Box 
                  key={sectionName} 
                  sx={{ mb: 2 }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e: any) => {
                    e.preventDefault();
                    const droppedDocId = e.dataTransfer.getData("text/plain");
                    if (droppedDocId) {
                      void handleDropDocument(droppedDocId, sectionName, sectionDocs.length);
                    }
                  }}
                >
                  <Accordion 
                    expanded={!!expandedSections[sectionName]} 
                    onChange={() => toggleSectionExpanded(sectionName)}
                    sx={{ bgcolor: 'action.hover', backgroundImage: 'none' }}
                  >
                    <AccordionSummary expandIcon={
                      <ExpandMoreIcon />
                    }>
                      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", width: "100%", pr: 2 }}>
                        <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
                          <FolderIcon />
                          <Box>
                            <Typography variant="subtitle1" sx={{ fontWeight: "bold" }}>{sectionName}</Typography>
                            <Typography variant="caption" color="text.secondary">{getSectionDescription(sectionName)}</Typography>
                          </Box>
                        </Stack>
                        <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
                          <Button size="small" onClick={(e: any) => { e.stopPropagation(); void handleRenameSection(sectionName); }}>Rename</Button>
                          <Chip size="small" label={`${sectionDocs.length} DOCS`} />
                        </Stack>
                      </Stack>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Stack spacing={2}>
                        {sectionDocs.map((doc, index) => (
                           <Paper
                             key={doc.id}
                             variant="outlined"
                             draggable
                             onDragStart={(e: any) => {
                               // Don't start drag when user is clicking an interactive element
                               const t = e.target as HTMLElement;
                               if (t.closest('button, input, select, [role="button"], [role="combobox"], [role="option"], .MuiSelect-select')) {
                                 e.preventDefault();
                                 return;
                               }
                               e.dataTransfer.setData("text/plain", doc.id);
                               setDraggingDocId(doc.id);
                             }}
                             onDragEnd={() => setDraggingDocId(null)}
                            onDragOver={(e: any) => e.preventDefault()}
                            onDrop={(e: any) => {
                              e.preventDefault();
                              const droppedDocId = e.dataTransfer.getData("text/plain");
                              if (droppedDocId) {
                                void handleDropDocument(droppedDocId, sectionName, index);
                              }
                            }}
                            sx={{
                              p: 2,
                              opacity: draggingDocId === doc.id ? 0.5 : 1,
                              borderColor: selectedDocId === doc.id ? 'primary.main' : 'divider',
                              bgcolor: selectedDocId === doc.id ? 'action.selected' : 'background.paper',
                              '&:hover': { borderColor: 'primary.light' },
                              transition: 'all 0.2s'
                            }}
                          >
                            <Stack direction="row" spacing={2} sx={{ alignItems: "flex-start" }}>
                              <Checkbox 
                                size="small" 
                                checked={selectedDocumentIds.includes(doc.id)} 
                                onChange={() => toggleDocumentSelection(doc.id)} 
                              />
                              <Box sx={{ cursor: 'pointer', flexGrow: 1 }} onClick={() => setSelectedDocId(selectedDocId === doc.id ? null : doc.id)}>
                                <Typography variant="subtitle1" color="primary" sx={{ fontWeight: "bold" }}>
                                  {doc.display_title || doc.original_filename || doc.storage_uri}
                                </Typography>
                                {doc.display_title && doc.original_filename && (
                                  <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.25, fontStyle: 'italic' }}>
                                    {doc.original_filename}
                                  </Typography>
                                )}
                                {doc.summary && (
                                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                    {doc.summary}
                                  </Typography>
                                )}
                                <Stack direction="row" spacing={2} sx={{ alignItems: "center", mt: 2 }}>
                                  <Typography variant="caption" color="text.disabled" sx={{ textTransform: "uppercase" }}>{doc.file_type}</Typography>
                                  {doc.page_count && <Typography variant="caption" color="text.disabled">{doc.page_count} page(s)</Typography>}
                                  {doc.is_vectorized && <Chip size="small" color="success" variant="outlined" label="Indexed" sx={{ height: 20, fontSize: '0.65rem' }} />}
                                </Stack>
                                {doc.status === "failed" && doc.status_message && (
                                  <Typography variant="caption" color="error" sx={{ mt: 1, display: 'block' }}>{doc.status_message}</Typography>
                                )}
                                <Typography variant="caption" color="text.disabled" sx={{ mt: 1, display: 'block' }}>
                                  Uploaded {formatDateTime(doc.created_at)}
                                </Typography>
                              </Box>
                              <Stack
                                spacing={1}
                                sx={{ alignItems: "flex-end" }}
                                onMouseDown={(e) => e.stopPropagation()}
                              >
                                 <StatusBadge status={doc.status} />
                                 <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                                   <TextField
                                     select
                                     size="small"
                                     value={doc.section_label || "Ungrouped"}
                                     onChange={(e) => {
                                       void saveDocumentPlacement(doc, e.target.value === "Ungrouped" ? null : e.target.value, doc.sort_order);
                                     }}
                                    sx={{ minWidth: 120, '& .MuiInputBase-input': { py: 0.5, px: 1, fontSize: '0.75rem' } }}
                                  >
                                    {Array.from(new Set(["Ungrouped", ...STANDARD_SECTIONS, ...sectionEntries.map(([name]) => name)])).map((name) => (
                                      <MenuItem key={name} value={name} sx={{ fontSize: '0.75rem' }}>{name}</MenuItem>
                                    ))}
                                  </TextField>
                                  <Stack>
                                    {index > 0 && <Button size="small" sx={{ minWidth: 30, p: 0, fontSize: '0.6rem' }} onClick={() => void saveDocumentPlacement(doc, doc.section_label, Math.max(0, doc.sort_order - 1))}>Up</Button>}
                                    {index < sectionDocs.length - 1 && <Button size="small" sx={{ minWidth: 30, p: 0, fontSize: '0.6rem' }} onClick={() => void saveDocumentPlacement(doc, doc.section_label, doc.sort_order + 1)}>Dn</Button>}
                                  </Stack>
                                </Stack>
                                <Stack direction="row" spacing={1}>
                                  {(doc.status === "failed" || doc.status === "pending") && (
                                    <Button size="small" color="primary" onClick={() => handleRetryDocument(doc.id)} disabled={retryMutation.isPending} sx={{ fontSize: '0.7rem' }}>Retry</Button>
                                  )}
                                  {doc.status === "completed" && (
                                    <Button size="small" color="inherit" onClick={async () => {
                                      try { await resummarizeDocMutation.mutateAsync(doc.id); toast.success("Summary updated."); } 
                                      catch (err: any) { toast.error(err?.response?.data?.detail || "Failed to re-summarize."); }
                                    }} disabled={resummarizeDocMutation.isPending} sx={{ fontSize: '0.7rem' }}>Re-summarize</Button>
                                  )}
                                  <Button size="small" color="error" onClick={() => handleDeleteDocument(doc.id, doc.original_filename || doc.storage_uri)} disabled={deleteMutation.isPending} sx={{ fontSize: '0.7rem' }}>Delete</Button>
                                </Stack>
                              </Stack>
                            </Stack>
                          </Paper>
                        ))}
                      </Stack>
                    </AccordionDetails>
                  </Accordion>
                </Box>
              ))}
            </Stack>
          )}
        </Box>
      </Box>

      {/* Document Preview Panel */}
      {selectedDoc && (
        <Box sx={{ width: "50%", flexShrink: 0, overflowY: "auto", bgcolor: "background.default", p: 4, borderLeft: 1, borderColor: "divider" }}>
          <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", mb: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: "bold" }}>
              {compareDoc ? "Document Comparison" : "Document Preview"}
            </Typography>
            <IconButton onClick={() => { setSelectedDocId(null); setCompareDocId(null); }}>
              <CloseIcon />
            </IconButton>
          </Stack>
          {compareDoc ? (
            <Box sx={{ display: 'flex', gap: 2 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>{renderDocumentPreview(selectedDoc, "Primary")}</Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>{renderDocumentPreview(compareDoc, "Comparison")}</Box>
            </Box>
          ) : (
            renderDocumentPreview(selectedDoc, "Primary")
          )}
        </Box>
      )}
    </Box>
  );
}
