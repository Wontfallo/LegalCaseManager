"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { useSemanticSearch } from "@/hooks/useApi";
import type { CaseDetailResponse } from "@/types";
import { formatDate, formatDateTime } from "@/lib/utils";

interface Props {
  caseDetail: CaseDetailResponse;
}

export default function CaseOverviewTab({ caseDetail }: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const searchMutation = useSemanticSearch();

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      toast.error("Enter something to search for.");
      return;
    }

    try {
      await searchMutation.mutateAsync({
        query: searchQuery.trim(),
        case_id: caseDetail.id,
        top_k: 8,
      });
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Semantic search failed.");
    }
  };

  return (
    <div className="px-12 py-10 max-w-6xl">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {/* Case Information */}
        <div className="p-8 rounded-2xl bg-[#12141A]/60 border border-white/5 backdrop-blur-md shadow-[0_8px_30px_rgba(0,0,0,0.4)]">
          <h3 className="text-sm font-bold text-[#8251EE] uppercase tracking-[0.2em] mb-6">
            Case Details
          </h3>
          <dl className="space-y-4">
            <div>
              <dt className="text-[10px] font-bold text-[#A1A1AA] uppercase tracking-[0.2em]">
                Title
              </dt>
              <dd className="mt-1 text-base font-bold text-white">
                {caseDetail.title}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-bold text-[#A1A1AA] uppercase tracking-[0.2em]">
                Status
              </dt>
              <dd className="mt-1 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[#10B981]" />
                <span className="text-sm font-bold text-white uppercase tracking-wider">
                  {caseDetail.status.replaceAll("_", " ")}
                </span>
              </dd>
            </div>
            {caseDetail.filing_date && (
              <div>
                <dt className="text-[10px] font-bold text-[#A1A1AA] uppercase tracking-[0.2em]">
                  Filing Date
                </dt>
                <dd className="mt-1 text-sm font-bold text-white/80">
                  {formatDate(caseDetail.filing_date)}
                </dd>
              </div>
            )}
          </dl>
        </div>

        {/* Client Information */}
        <div className="p-8 rounded-2xl bg-[#12141A]/60 border border-white/5 backdrop-blur-md shadow-[0_8px_30px_rgba(0,0,0,0.4)]">
          <h3 className="text-sm font-bold text-[#8251EE] uppercase tracking-[0.2em] mb-6">
            Client
          </h3>
          <dl className="space-y-4">
            <div>
              <dt className="text-[10px] font-bold text-[#A1A1AA] uppercase tracking-[0.2em]">
                Name
              </dt>
              <dd className="mt-1 text-base font-bold text-white">
                {caseDetail.client.name}
              </dd>
            </div>
            {caseDetail.client.contact_info && (
              <>
                {(caseDetail.client.contact_info as Record<string, string>)?.email && (
                  <div>
                    <dt className="text-[10px] font-bold text-[#A1A1AA] uppercase tracking-[0.2em]">
                      Email
                    </dt>
                    <dd className="mt-1 text-sm font-bold text-white/80">
                      {(caseDetail.client.contact_info as Record<string, string>).email}
                    </dd>
                  </div>
                )}
              </>
            )}
          </dl>
        </div>

        {/* Statistics Cards */}
        <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-8 rounded-2xl bg-gradient-to-br from-[#8251EE]/20 to-[#8251EE]/5 border border-[#8251EE]/20 shadow-[0_8px_30px_rgba(130,81,238,0.1)]">
            <p className="text-5xl font-black text-white">{caseDetail.document_count}</p>
            <p className="mt-2 text-[10px] font-bold text-[#8251EE] uppercase tracking-[0.2em]">Documents Ingested</p>
          </div>
          <div className="p-8 rounded-2xl bg-gradient-to-br from-[#3B82F6]/20 to-[#3B82F6]/5 border border-[#3B82F6]/20 shadow-[0_8px_30px_rgba(59,130,246,0.1)]">
            <p className="text-5xl font-black text-white">{caseDetail.communication_count}</p>
            <p className="mt-2 text-[10px] font-bold text-[#3B82F6] uppercase tracking-[0.2em]">Communications</p>
          </div>
          <div className="p-8 rounded-2xl bg-gradient-to-br from-[#10B981]/20 to-[#10B981]/5 border border-[#10B981]/20 shadow-[0_8px_30px_rgba(16,185,129,0.1)]">
            <p className="text-5xl font-black text-white">{caseDetail.timeline_event_count}</p>
            <p className="mt-2 text-[10px] font-bold text-[#10B981] uppercase tracking-[0.2em]">Timeline Events</p>
          </div>
        </div>

        <div className="lg:col-span-3 p-10 rounded-2xl bg-[#0D0F14] border border-white/5 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-[300px] h-[300px] bg-[#8251EE]/10 blur-[100px] -mr-32 -mt-32 transition-all duration-500 group-hover:bg-[#8251EE]/20" />
          <div className="relative z-10 flex flex-col gap-6">
            <div>
              <h3 className="text-2xl font-bold text-white mb-2">Semantic AI Search</h3>
              <p className="text-[#A1A1AA] font-medium">Query across your case data using natural language meaning.</p>
            </div>
            <div className="flex gap-4">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search case meaning..."
                className="flex-1 bg-black/40 border border-white/10 rounded-xl px-6 py-4 text-white placeholder-white/20 focus:outline-none focus:border-[#8251EE]/50 transition-all font-medium"
              />
              <button
                onClick={() => handleSearch()}
                disabled={searchMutation.isPending}
                className="px-8 py-4 bg-[#8251EE] text-white font-bold rounded-xl hover:bg-[#9366F5] shadow-[0_0_20px_rgba(130,81,238,0.3)] transition-all active:scale-95 disabled:opacity-50"
              >
                {searchMutation.isPending ? "Searching..." : "Search"}
              </button>
            </div>
          </div>

          {searchMutation.data && (
            <div className="mt-5 space-y-3">
              {searchMutation.data.length === 0 ? (
                <div className="rounded-lg surface-muted border p-4 text-sm text-muted">
                  No matching indexed content found.
                </div>
              ) : (
                searchMutation.data.map((result, index) => (
                  <div key={`${result.source_id}-${index}`} className="rounded-lg border surface-muted p-4">
                    <div className="flex items-center justify-between gap-3 mb-2 text-xs">
                      <span className="font-medium uppercase text-muted">
                        {result.source_type}
                      </span>
                      <span className="text-muted">
                        Match {(result.similarity_score * 100).toFixed(0)}%
                      </span>
                    </div>
                    <p className="text-sm text-body whitespace-pre-wrap leading-relaxed">
                      {result.text_chunk}
                    </p>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
