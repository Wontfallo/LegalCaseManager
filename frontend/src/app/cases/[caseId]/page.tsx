"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import CaseOverviewTab from "@/components/cases/CaseOverviewTab";
import AssistantTab from "@/components/cases/AssistantTab";
import DocumentsTab from "@/components/cases/DocumentsTab";
import CommunicationsTab from "@/components/cases/CommunicationsTab";
import TimelineTab from "@/components/cases/TimelineTab";
import { useCaseDetail, useCaseDocuments } from "@/hooks/useApi";
import { getStatusColor, cn } from "@/lib/utils";
import { motion } from "framer-motion";

type TabKey = "overview" | "documents" | "communications" | "timeline" | "assistant";

const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "documents", label: "Documents" },
  { key: "communications", label: "Communication Logs" },
  { key: "timeline", label: "Timeline" },
  { key: "assistant", label: "Assistant" },
];

export default function CaseDetailPage() {
  const params = useParams();
  const caseId = params.caseId as string;
  const { data: caseDetail, isLoading } = useCaseDetail(caseId);
  const { data: documents } = useCaseDocuments(caseId);
  const [activeTab, setActiveTab] = useState<TabKey>("overview");

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-full">
          <div className="animate-spin h-8 w-8 rounded-full border-4 border-brand-600 border-t-transparent" />
        </div>
      </AppShell>
    );
  }

  if (!caseDetail) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-full">
          <p className="text-slate-600 dark:text-slate-400">Case not found.</p>
        </div>
      </AppShell>
    );
  }

  const statusColors = getStatusColor(caseDetail.status);
  const liveDocumentCount = documents?.length ?? caseDetail.document_count;

  return (
    <AppShell>
      <div className="h-full flex flex-col bg-[#0A0C10]">
        {/* Case Header */}
        <div className="flex-shrink-0 border-b border-white/5 bg-[#0D0F14]/80 backdrop-blur-xl px-12 py-8 relative z-30">
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-8 py-2">
            <div>
              <div className="flex items-center gap-4">
                <h1 className="text-3xl font-bold tracking-tight text-white mb-1">
                  {caseDetail.title}
                </h1>
                <span
                  className={cn(
                    "inline-flex items-center rounded-lg px-3 py-1 text-[11px] font-bold uppercase tracking-widest ring-1 ring-inset",
                    statusColors.bg,
                    statusColors.text,
                    statusColors.ring
                  )}
                >
                  {caseDetail.status.replaceAll("_", " ")}
                </span>
              </div>
              <p className="mt-1.5 text-base text-[#A1A1AA] font-medium flex items-center gap-2">
                <span className="h-1 w-1 rounded-full bg-[#8251EE]" />
                Client: <span className="text-white">{caseDetail.client.name}</span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-12">
              <div className="group">
                <p className="text-3xl font-extrabold text-white group-hover:text-[#8251EE] transition-colors duration-300">
                  {liveDocumentCount}
                </p>
                <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-[#A1A1AA] mt-1">Documents</p>
              </div>
              <div className="group">
                <p className="text-3xl font-extrabold text-white group-hover:text-[#8251EE] transition-colors duration-300">
                  {caseDetail.communication_count}
                </p>
                <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-[#A1A1AA] mt-1">Communications</p>
              </div>
              <div className="group">
                <p className="text-3xl font-extrabold text-white group-hover:text-[#8251EE] transition-colors duration-300">
                  {caseDetail.timeline_event_count}
                </p>
                <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-[#A1A1AA] mt-1">Events</p>
              </div>
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="mt-10 flex gap-2">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "relative px-6 py-3 text-xs font-bold uppercase tracking-widest rounded-xl transition-all duration-300",
                  activeTab === tab.key
                    ? "bg-[#8251EE]/10 text-[#8251EE] shadow-[0_0_20px_rgba(130,81,238,0.1)] border border-[#8251EE]/20"
                    : "text-[#A1A1AA] hover:text-white hover:bg-white/5 border border-transparent"
                )}
              >
                {tab.label}
                {activeTab === tab.key && (
                  <motion.div
                    layoutId="activeTab"
                    className="absolute -bottom-[2px] left-0 right-0 h-[2px] bg-[#8251EE]"
                    initial={false}
                  />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-auto">
          {activeTab === "overview" && (
            <CaseOverviewTab caseDetail={caseDetail} />
          )}
          {activeTab === "documents" && <DocumentsTab caseId={caseId} />}
          {activeTab === "communications" && (
            <CommunicationsTab caseId={caseId} />
          )}
          {activeTab === "timeline" && <TimelineTab caseId={caseId} />}
          {activeTab === "assistant" && <AssistantTab caseId={caseId} />}
        </div>
      </div>
    </AppShell>
  );
}
