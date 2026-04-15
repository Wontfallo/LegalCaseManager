"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import CaseOverviewTab from "@/components/cases/CaseOverviewTab";
import DocumentsTab from "@/components/cases/DocumentsTab";
import CommunicationsTab from "@/components/cases/CommunicationsTab";
import TimelineTab from "@/components/cases/TimelineTab";
import { useCaseDetail, useCaseDocuments } from "@/hooks/useApi";
import { getStatusColor, cn } from "@/lib/utils";

type TabKey = "overview" | "documents" | "communications" | "timeline";

const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "documents", label: "Documents" },
  { key: "communications", label: "Communication Logs" },
  { key: "timeline", label: "Timeline" },
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
      <div className="h-full flex flex-col">
        {/* Case Header */}
        <div className="flex-shrink-0 border-b border-slate-200 bg-white px-8 py-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-bold text-heading">
                  {caseDetail.title}
                </h1>
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
                    statusColors.bg,
                    statusColors.text,
                    statusColors.ring
                  )}
                >
                  {caseDetail.status.replaceAll("_", " ")}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted">
                Client: {caseDetail.client.name}
              </p>
            </div>
            <div className="flex gap-6 text-center">
              <div>
                <p className="text-2xl font-bold text-heading">
                  {liveDocumentCount}
                </p>
                <p className="text-xs text-muted">Documents</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-heading">
                  {caseDetail.communication_count}
                </p>
                <p className="text-xs text-muted">Communications</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-heading">
                  {caseDetail.timeline_event_count}
                </p>
                <p className="text-xs text-muted">Events</p>
              </div>
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="mt-5 flex gap-1">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "px-4 py-2 text-sm font-medium rounded-lg transition-colors",
                  activeTab === tab.key
                    ? "bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800"
                )}
              >
                {tab.label}
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
        </div>
      </div>
    </AppShell>
  );
}
