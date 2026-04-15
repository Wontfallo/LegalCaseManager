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
    <div className="px-8 py-6 max-w-4xl">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Case Information */}
        <div className="card">
          <h3 className="text-base font-semibold text-heading mb-4">
            Case Information
          </h3>
          <dl className="space-y-3">
            <div>
              <dt className="text-xs font-medium text-muted uppercase tracking-wider">
                Title
              </dt>
              <dd className="mt-0.5 text-sm text-heading">
                {caseDetail.title}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted uppercase tracking-wider">
                Status
              </dt>
              <dd className="mt-0.5 text-sm text-heading">
                {caseDetail.status.replaceAll("_", " ")}
              </dd>
            </div>
            {caseDetail.filing_date && (
              <div>
                <dt className="text-xs font-medium text-muted uppercase tracking-wider">
                  Filing Date
                </dt>
                <dd className="mt-0.5 text-sm text-heading">
                  {formatDate(caseDetail.filing_date)}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-xs font-medium text-muted uppercase tracking-wider">
                Created
              </dt>
              <dd className="mt-0.5 text-sm text-heading">
                {formatDateTime(caseDetail.created_at)}
              </dd>
            </div>
          </dl>
        </div>

        {/* Client Information */}
        <div className="card">
          <h3 className="text-base font-semibold text-heading mb-4">
            Client Information
          </h3>
          <dl className="space-y-3">
            <div>
              <dt className="text-xs font-medium text-muted uppercase tracking-wider">
                Name
              </dt>
              <dd className="mt-0.5 text-sm text-heading">
                {caseDetail.client.name}
              </dd>
            </div>
            {caseDetail.client.contact_info && (
              <>
                {(caseDetail.client.contact_info as Record<string, string>)
                  ?.email && (
                  <div>
                    <dt className="text-xs font-medium text-muted uppercase tracking-wider">
                      Email
                    </dt>
                    <dd className="mt-0.5 text-sm text-heading">
                      {
                        (
                          caseDetail.client.contact_info as Record<
                            string,
                            string
                          >
                        ).email
                      }
                    </dd>
                  </div>
                )}
                {(caseDetail.client.contact_info as Record<string, string>)
                  ?.phone && (
                  <div>
                    <dt className="text-xs font-medium text-muted uppercase tracking-wider">
                      Phone
                    </dt>
                    <dd className="mt-0.5 text-sm text-heading">
                      {
                        (
                          caseDetail.client.contact_info as Record<
                            string,
                            string
                          >
                        ).phone
                      }
                    </dd>
                  </div>
                )}
              </>
            )}
          </dl>
        </div>

        {/* Description */}
        {caseDetail.description && (
          <div className="card md:col-span-2">
            <h3 className="text-base font-semibold text-heading mb-4">
              Description
            </h3>
            <p className="text-sm text-body whitespace-pre-wrap leading-relaxed">
              {caseDetail.description}
            </p>
          </div>
        )}

        {/* Statistics */}
        <div className="card md:col-span-2">
          <h3 className="text-base font-semibold text-heading mb-4">
            Case Statistics
          </h3>
          <div className="grid grid-cols-3 gap-6">
            <div className="rounded-lg bg-blue-50 p-4 text-center dark:bg-blue-950/30">
              <p className="text-3xl font-bold text-blue-700 dark:text-blue-400">
                {caseDetail.document_count}
              </p>
              <p className="mt-1 text-sm text-blue-600 dark:text-blue-400">Documents Ingested</p>
            </div>
            <div className="rounded-lg bg-emerald-50 p-4 text-center dark:bg-emerald-950/30">
              <p className="text-3xl font-bold text-emerald-700 dark:text-emerald-400">
                {caseDetail.communication_count}
              </p>
              <p className="mt-1 text-sm text-emerald-600 dark:text-emerald-400">
                Communications Logged
              </p>
            </div>
            <div className="rounded-lg bg-purple-50 p-4 text-center dark:bg-purple-950/30">
              <p className="text-3xl font-bold text-purple-700 dark:text-purple-400">
                {caseDetail.timeline_event_count}
              </p>
              <p className="mt-1 text-sm text-purple-600 dark:text-purple-400">
                Timeline Events Extracted
              </p>
            </div>
          </div>
        </div>

        <div className="card md:col-span-2">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h3 className="text-base font-semibold text-heading">
                Semantic Search
              </h3>
              <p className="mt-1 text-sm text-muted">
                Search across uploaded documents and indexed text by meaning, not just exact words.
              </p>
            </div>
          </div>

          <div className="flex gap-3">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  void handleSearch();
                }
              }}
              className="input-field"
              placeholder="Search this case, e.g. balcony repair scope or January board agenda"
            />
            <button
              onClick={() => void handleSearch()}
              disabled={searchMutation.isPending}
              className="btn-primary whitespace-nowrap"
            >
              {searchMutation.isPending ? "Searching..." : "Search"}
            </button>
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
