"use client";

import { FormEvent, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { motion, AnimatePresence } from "framer-motion";
import { useCaseAssistantChat } from "@/hooks/useApi";
import type { AssistantMessage } from "@/types";

interface Props {
  caseId: string;
}

const STARTER_PROMPTS = [
  "Organize my files into the right sections.",
  "What documents mention balcony issues?",
  "Summarize the strongest evidence in this case.",
  "Find duplicate documents.",
];

export default function AssistantTab({ caseId }: Props) {
  const assistantChat = useCaseAssistantChat(caseId);
  const [messages, setMessages] = useState<AssistantMessage[]>([
    {
      role: "assistant",
      content:
        "I can review this case, discuss your documents, organize files, search for topics, and surface duplicates. Ask directly.",
    },
  ]);
  const [input, setInput] = useState("");

  const canSend = input.trim().length > 0 && !assistantChat.isPending;

  const toolLabel = useMemo(
    () =>
      new Intl.DisplayNames(["en"], {
        type: "language",
        fallback: "none",
      }),
    []
  );
  void toolLabel;

  const sendMessage = async (content: string) => {
    const nextMessages: AssistantMessage[] = [...messages, { role: "user", content }];
    setMessages(nextMessages);
    setInput("");

    try {
      const response = await assistantChat.mutateAsync({ messages: nextMessages });
      setMessages((current) => [...current, response.message]);
      if (response.tool_calls.some((call) => call.tool_name === "organize_documents")) {
        toast.success("Assistant reorganized the case documents.");
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Assistant request failed.");
      setMessages((current) => current.slice(0, -1));
      setInput(content);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = input.trim();
    if (!content) return;
    await sendMessage(content);
  };

  return (
    <div className="h-full bg-[#0A0C10] px-8 py-8">
      <div className="mx-auto flex h-full max-w-7xl gap-6 xl:grid xl:grid-cols-[1.8fr_0.9fr]">
        <div className="flex min-h-[720px] flex-1 flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top,#181d2a,transparent_45%),linear-gradient(180deg,#11141b,#0b0d12)] shadow-[0_25px_80px_rgba(0,0,0,0.45)]">
          <div className="border-b border-white/10 px-6 py-5">
            <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-[#8B8FA3]">
              Case Assistant
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-white">
              Chat With Your Documents
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-[#9FA6B8]">
              Ask questions about the case, tell it to reorganize files, search for topics, or review likely duplicates.
            </p>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-6">
            <AnimatePresence initial={false}>
              {messages.map((message, index) => (
                <motion.div
                  key={`${message.role}-${index}-${message.content.slice(0, 20)}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className={`max-w-[88%] rounded-3xl px-5 py-4 ${
                    message.role === "user"
                      ? "ml-auto bg-[#8251EE] text-white shadow-[0_12px_40px_rgba(130,81,238,0.28)]"
                      : "border border-white/10 bg-white/[0.04] text-white"
                  }`}
                >
                  <p className="whitespace-pre-wrap text-sm leading-6">{message.content}</p>
                </motion.div>
              ))}
            </AnimatePresence>

            {assistantChat.isPending && (
              <div className="max-w-[88%] rounded-3xl border border-white/10 bg-white/[0.04] px-5 py-4 text-white">
                <div className="flex items-center gap-2 text-sm text-[#C7CAD6]">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-[#8251EE]" />
                  Assistant is reviewing the case...
                </div>
                {assistantChat.variables?.messages?.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[#9FA6B8]">
                      Document-aware tools enabled
                    </span>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <form onSubmit={handleSubmit} className="border-t border-white/10 px-6 py-5">
            <div className="flex gap-3">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Ask about your case, documents, duplicates, or tell it to organize the files..."
                rows={3}
                className="min-h-[88px] flex-1 resize-none rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-[#6B7280] focus:border-[#8251EE]/50 focus:ring-2 focus:ring-[#8251EE]/20"
              />
              <button
                type="submit"
                disabled={!canSend}
                className="self-end rounded-2xl bg-[#8251EE] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#9364f0] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Send
              </button>
            </div>
          </form>
        </div>

        <div className="flex w-[340px] flex-col gap-4 xl:w-auto">
          <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.3)]">
            <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-[#8B8FA3]">
              Quick Prompts
            </p>
            <div className="mt-4 space-y-3">
              {STARTER_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => sendMessage(prompt)}
                  disabled={assistantChat.isPending}
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-left text-sm text-[#E4E7F0] transition hover:border-[#8251EE]/30 hover:bg-[#8251EE]/10 disabled:opacity-50"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.3)]">
            <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-[#8B8FA3]">
              Built-in Tools
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {[
                "Organize documents",
                "List documents",
                "Open document details",
                "Semantic search",
                "Scan duplicates",
              ].map((tool) => (
                <span
                  key={tool}
                  className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[#C7CAD6]"
                >
                  {tool}
                </span>
              ))}
            </div>
            <p className="mt-4 text-sm leading-6 text-[#9FA6B8]">
              This assistant is scoped to the current case. It can reason over summaries, OCR text, sections, and vector search results.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
