"use client";

import { useState, useMemo, useCallback } from "react";
import { useCaseTimeline, useTimelineEventDetail } from "@/hooks/useApi";
import {
  formatDate,
  formatDateTime,
  getConfidenceColor,
  cn,
} from "@/lib/utils";
import {
  differenceInDays,
  parseISO,
  format,
  startOfDay,
  addDays,
} from "date-fns";
import type { TimelineEventResponse, TimelineEventDetail } from "@/types";

interface Props {
  caseId: string;
}

type ZoomLevel = "years" | "months" | "weeks" | "days";

const ZOOM_LABELS: Record<ZoomLevel, string> = {
  years: "Multi-Year",
  months: "Monthly",
  weeks: "Weekly",
  days: "Daily",
};

export default function TimelineTab({ caseId }: Props) {
  const [minConfidence, setMinConfidence] = useState(0.0);
  const { data: events, isLoading } = useCaseTimeline(caseId, {
    minConfidence,
  });

  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>("months");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  // Fetch detail with source preview when an event is selected
  const { data: selectedDetail, isLoading: detailLoading } =
    useTimelineEventDetail(
      caseId,
      selectedEventId || ""
    );

  // Compute timeline range
  const timelineData = useMemo(() => {
    if (!events || events.length === 0) return null;

    const sorted = [...events].sort(
      (a, b) =>
        new Date(a.absolute_timestamp).getTime() -
        new Date(b.absolute_timestamp).getTime()
    );

    const startDate = parseISO(sorted[0].absolute_timestamp);
    const endDate = parseISO(sorted[sorted.length - 1].absolute_timestamp);
    const totalDays = differenceInDays(endDate, startDate) || 1;

    return { sorted, startDate, endDate, totalDays };
  }, [events]);

  // Group events by time bucket based on zoom level
  const groupedEvents = useMemo(() => {
    if (!timelineData) return new Map<string, TimelineEventResponse[]>();

    const groups = new Map<string, TimelineEventResponse[]>();

    timelineData.sorted.forEach((event) => {
      const date = parseISO(event.absolute_timestamp);
      let key: string;

      switch (zoomLevel) {
        case "years":
          key = format(date, "yyyy");
          break;
        case "months":
          key = format(date, "yyyy-MM");
          break;
        case "weeks": {
          const weekStart = startOfDay(
            addDays(date, -date.getDay())
          );
          key = format(weekStart, "yyyy-MM-dd");
          break;
        }
        case "days":
          key = format(date, "yyyy-MM-dd");
          break;
      }

      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(event);
    });

    return groups;
  }, [timelineData, zoomLevel]);

  const formatBucketLabel = (key: string): string => {
    switch (zoomLevel) {
      case "years":
        return key;
      case "months":
        return format(parseISO(`${key}-01`), "MMM yyyy");
      case "weeks":
        return `Week of ${format(parseISO(key), "MMM d, yyyy")}`;
      case "days":
        return format(parseISO(key), "EEEE, MMM d, yyyy");
    }
  };

  const handleEventClick = useCallback((eventId: string) => {
    setSelectedEventId((prev) => (prev === eventId ? null : eventId));
  }, []);

  // Minimap slider: map 0-100 to zoom levels
  const zoomSliderValue = useMemo(() => {
    const mapping: Record<ZoomLevel, number> = {
      years: 0,
      months: 33,
      weeks: 66,
      days: 100,
    };
    return mapping[zoomLevel];
  }, [zoomLevel]);

  const handleZoomChange = (value: number) => {
    if (value <= 16) setZoomLevel("years");
    else if (value <= 50) setZoomLevel("months");
    else if (value <= 83) setZoomLevel("weeks");
    else setZoomLevel("days");
  };

  const getSourceTypeIcon = (sourceType: string | null) => {
    if (sourceType === "document") {
      return (
        <svg
          className="h-4 w-4 text-blue-500"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
          />
        </svg>
      );
    }
    return (
      <svg
        className="h-4 w-4 text-emerald-500"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"
        />
      </svg>
    );
  };

  return (
    <div className="h-full flex flex-col bg-[#0A0C10]">
      {/* Timeline Controls Bar */}
      <div className="flex-shrink-0 border-b border-white/5 bg-[#0D0F14]/40 px-12 py-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            {/* Minimap Slider */}
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-muted whitespace-nowrap">
                Zoom:
              </span>
              <div className="flex items-center gap-2 w-48">
                <span className="text-[10px] text-faint">Years</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={zoomSliderValue}
                  onChange={(e) => handleZoomChange(Number(e.target.value))}
                  className="minimap-slider flex-1"
                />
                <span className="text-[10px] text-faint">Days</span>
              </div>
              <span className="text-xs font-semibold text-brand-600">
                {ZOOM_LABELS[zoomLevel]}
              </span>
            </div>

            {/* Confidence Filter */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted">
                Min Confidence:
              </span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={minConfidence}
                onChange={(e) =>
                  setMinConfidence(parseFloat(e.target.value))
                }
                className="w-24 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 appearance-none cursor-pointer"
              />
              <span className="text-xs font-semibold text-body">
                {(minConfidence * 100).toFixed(0)}%
              </span>
            </div>
          </div>

          <div className="text-sm text-muted">
            {events?.length || 0} events
          </div>
        </div>
      </div>

      {/* Split-screen layout: Timeline + Evidence Panel */}
      <div className="flex-1 flex overflow-hidden">
        {/* Timeline Panel */}
        <div
          className={cn(
            "overflow-auto custom-scrollbar transition-all duration-300",
            selectedEventId ? "w-1/2 border-r border-slate-200 dark:border-slate-800" : "w-full"
          )}
        >
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin h-8 w-8 rounded-full border-4 border-brand-600 border-t-transparent" />
            </div>
          ) : !events || events.length === 0 ? (
            <div className="text-center py-20">
              <svg
                className="mx-auto h-12 w-12 text-slate-300 dark:text-slate-600"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <h3 className="mt-4 text-lg font-medium text-heading">
                No timeline events
              </h3>
              <p className="mt-2 text-sm text-muted">
                Upload documents or log communications to automatically extract events.
              </p>
            </div>
          ) : (
            <div className="px-8 py-6">
              {/* Vertical timeline */}
              <div className="relative">
                {/* Vertical line */}
                <div className="absolute left-4 top-0 bottom-0 w-[1px] bg-gradient-to-b from-[#8251EE]/50 via-[#8251EE]/20 to-transparent" />

                {Array.from(groupedEvents.entries()).map(
                  ([bucketKey, bucketEvents]) => (
                    <div key={bucketKey} className="mb-12">
                      {/* Bucket Header */}
                      <div className="relative flex items-center mb-6">
                        <div className="absolute left-[13px] w-2 h-2 rounded-full bg-[#8251EE] shadow-[0_0_10px_rgba(130,81,238,0.8)] z-10" />
                        <h4 className="ml-12 text-[11px] font-bold uppercase tracking-[0.2em] text-[#8251EE]">
                          {formatBucketLabel(bucketKey)}
                        </h4>
                        <span className="ml-4 text-[11px] font-bold text-white/30 tracking-widest">
                          {bucketEvents.length} EVENT{bucketEvents.length !== 1 ? "S" : ""}
                        </span>
                      </div>

                      {/* Events in bucket */}
                      {bucketEvents.map((event) => (
                        <button
                          key={event.id}
                          onClick={() => handleEventClick(event.id)}
                          className={cn(
                            "timeline-node relative flex w-full text-left mb-4 ml-12 mr-6",
                            "rounded-2xl border p-6 transition-all duration-300 backdrop-blur-md",
                            selectedEventId === event.id
                              ? "border-[#8251EE] bg-[#8251EE]/10 shadow-[0_10px_30px_rgba(130,81,238,0.2)]"
                              : "border-white/5 bg-[#12141A]/60 hover:border-[#8251EE]/40 hover:bg-[#12141A]/80 shadow-[0_8px_20px_rgba(0,0,0,0.3)]"
                          )}
                        >
                          {/* Connector dot */}
                          <div
                            className={cn(
                              "absolute -left-[2.15rem] top-5 w-3 h-3 rounded-full border-2 z-10",
                              event.ai_confidence_score >= 0.8
                                ? "bg-emerald-400 border-emerald-500"
                                : event.ai_confidence_score >= 0.5
                                ? "bg-amber-400 border-amber-500"
                                : "bg-red-400 border-red-500"
                            )}
                          />

                           <div className="flex-1 min-w-0">
                             <div className="flex items-start justify-between gap-4">
                               <div className="flex-1">
                                 <p className="text-base font-bold text-white leading-relaxed group-hover:text-[#8251EE] transition-colors">
                                   {event.event_description}
                                 </p>
                                 <div className="mt-4 flex flex-wrap items-center gap-5">
                                   <span className="text-xs font-bold text-[#A1A1AA] uppercase tracking-widest font-mono">
                                     {formatDateTime(
                                       event.absolute_timestamp
                                     )}
                                   </span>
                                   <span
                                     className={cn(
                                       "text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded border",
                                       getConfidenceColor(
                                         event.ai_confidence_score
                                       ).includes("emerald") ? "text-[#10B981] border-[#10B981]/20 bg-[#10B981]/5" :
                                       getConfidenceColor(event.ai_confidence_score).includes("amber") ? "text-[#F59E0B] border-[#F59E0B]/20 bg-[#F59E0B]/5" :
                                       "text-[#EF4444] border-[#EF4444]/20 bg-[#EF4444]/5"
                                     )}
                                   >
                                     {(
                                       event.ai_confidence_score * 100
                                     ).toFixed(0)}
                                     % AI SCORE
                                   </span>
                                   {event.source_type && (
                                     <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white/40">
                                       {getSourceTypeIcon(event.source_type)}
                                       {event.source_type}
                                     </span>
                                   )}
                                 </div>
                               </div>

                              {/* Click indicator */}
                              <svg
                                className={cn(
                                  "h-4 w-4 flex-shrink-0 mt-1 transition-transform",
                                  selectedEventId === event.id
                                    ? "text-brand-500 rotate-90"
                                    : "text-slate-300"
                                )}
                                fill="none"
                                viewBox="0 0 24 24"
                                strokeWidth={2}
                                stroke="currentColor"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M8.25 4.5l7.5 7.5-7.5 7.5"
                                />
                              </svg>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )
                )}
              </div>
            </div>
          )}
        </div>

        {/* Evidence Verification Panel (Split-Screen) */}
        {selectedEventId && (
            <div className="w-1/2 overflow-auto evidence-panel-enter bg-slate-50 dark:bg-slate-900">
            <div className="px-6 py-6">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-base font-bold text-heading">
                  Source Evidence
                </h3>
                <button
                  onClick={() => setSelectedEventId(null)}
                  className="text-slate-400 hover:text-slate-600 transition-colors dark:hover:text-slate-300"
                >
                  <svg
                    className="h-5 w-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>

              {detailLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin h-6 w-6 rounded-full border-4 border-brand-600 border-t-transparent" />
                </div>
              ) : selectedDetail ? (
                <>
                  {/* Event Summary Card */}
                  <div className="card mb-5">
                    <h4 className="text-sm font-semibold text-heading mb-2">
                      Extracted Event
                    </h4>
                    <p className="text-sm text-body">
                      {selectedDetail.event_description}
                    </p>
                    <div className="mt-3 flex items-center gap-4 text-xs">
                      <span className="text-muted">
                        {formatDateTime(selectedDetail.absolute_timestamp)}
                      </span>
                      <span
                        className={cn(
                          "font-semibold",
                          getConfidenceColor(
                            selectedDetail.ai_confidence_score
                          )
                        )}
                      >
                        {(selectedDetail.ai_confidence_score * 100).toFixed(
                          0
                        )}
                        % confidence
                      </span>
                    </div>
                  </div>

                  {/* Source Document/Transcript */}
                  {selectedDetail.linked_source_preview ? (
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        {getSourceTypeIcon(
                          selectedDetail.linked_source_type || null
                        )}
                        <h4 className="text-sm font-semibold text-heading">
                          Source{" "}
                          {selectedDetail.linked_source_type === "document"
                            ? "Document"
                            : "Transcript"}
                        </h4>
                      </div>
                      <div className="rounded-lg bg-white border border-slate-200 p-4 max-h-[60vh] overflow-auto custom-scrollbar shadow-sm dark:bg-slate-950 dark:border-slate-800">
                        <pre className="text-xs text-body whitespace-pre-wrap font-mono leading-relaxed">
                          {selectedDetail.linked_source_preview}
                        </pre>
                      </div>
                      <p className="mt-2 text-[10px] text-faint">
                        Review the source text above to verify the AI&apos;s
                        temporal extraction.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-lg bg-amber-50 p-4 text-center dark:bg-amber-950/30">
                      <p className="text-sm text-amber-700 dark:text-amber-400">
                        Source content is not yet available. It may still be
                        processing.
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-8">
                  <p className="text-sm text-muted">
                    Could not load event details.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
