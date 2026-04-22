"use client";

import { useState, useMemo, useCallback } from "react";
import { useCaseTimeline, useTimelineEventDetail } from "@/hooks/useApi";
import { formatDateTime } from "@/lib/utils";
import { differenceInDays, parseISO, format, startOfDay, addDays } from "date-fns";
import type { TimelineEventResponse, TimelineEventDetail } from "@/types";
import {
  Box, Typography, Paper, Grid, Slider, CircularProgress, IconButton, Stack, Chip, Divider
} from "@mui/material";
import {
  Timeline, TimelineItem, TimelineSeparator, TimelineConnector, TimelineContent, TimelineDot, TimelineOppositeContent, timelineOppositeContentClasses
} from "@mui/lab";
import CloseIcon from "@mui/icons-material/Close";
import DescriptionIcon from "@mui/icons-material/Description";
import RecordVoiceOverIcon from "@mui/icons-material/RecordVoiceOver";

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

  const { data: selectedDetail, isLoading: detailLoading } =
    useTimelineEventDetail(
      caseId,
      selectedEventId || ""
    );

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

  const zoomSliderValue = useMemo(() => {
    const mapping: Record<ZoomLevel, number> = {
      years: 0,
      months: 33,
      weeks: 66,
      days: 100,
    };
    return mapping[zoomLevel];
  }, [zoomLevel]);

  const handleZoomChange = (event: Event, value: number | number[]) => {
    const val = value as number;
    if (val <= 16) setZoomLevel("years");
    else if (val <= 50) setZoomLevel("months");
    else if (val <= 83) setZoomLevel("weeks");
    else setZoomLevel("days");
  };

  const getSourceTypeIcon = (sourceType: string | null) => {
    if (sourceType === "document") {
      return <DescriptionIcon fontSize="small" color="primary" />;
    }
    return <RecordVoiceOverIcon fontSize="small" color="success" />;
  };

  const getConfidenceColorCode = (score: number) => {
    if (score >= 0.8) return "success";
    if (score >= 0.5) return "warning";
    return "error";
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Timeline Controls Bar */}
      <Paper square sx={{ px: 4, py: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: 1, borderColor: 'divider' }} elevation={0}>
        <Stack direction="row" spacing={6} sx={{ alignItems: 'center' }}>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center', width: 300 }}>
            <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 'bold' }}>Zoom:</Typography>
            <Typography variant="caption" color="text.secondary">Years</Typography>
            <Slider
              value={zoomSliderValue}
              onChange={handleZoomChange}
              step={1}
              min={0}
              max={100}
              sx={{ flexGrow: 1 }}
            />
            <Typography variant="caption" color="text.secondary">Days</Typography>
            <Typography variant="body2" color="primary" sx={{ fontWeight: 'bold' }}>
              {ZOOM_LABELS[zoomLevel]}
            </Typography>
          </Stack>

          <Stack direction="row" spacing={2} sx={{ alignItems: 'center', width: 250 }}>
            <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 'bold' }}>Min Confidence:</Typography>
            <Slider
              value={minConfidence}
              onChange={(e, val) => setMinConfidence(val as number)}
              step={0.1}
              min={0}
              max={1}
            />
            <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
              {(minConfidence * 100).toFixed(0)}%
            </Typography>
          </Stack>
        </Stack>

        <Typography variant="body2" color="text.secondary">
          {events?.length || 0} events
        </Typography>
      </Paper>

      {/* Main Split Content */}
      <Box sx={{ display: 'flex', flexGrow: 1, overflow: 'hidden' }}>
        {/* Timeline Area */}
        <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 4, borderRight: selectedEventId ? 1 : 0, borderColor: 'divider' }}>
          {isLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
              <CircularProgress />
            </Box>
          ) : !events || events.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 10 }}>
              <Typography variant="h6" color="text.primary">No timeline events</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Upload documents or log communications to automatically extract events.
              </Typography>
            </Box>
          ) : (
            <Timeline
              sx={{
                [`& .${timelineOppositeContentClasses.root}`]: {
                  flex: 0.15,
                },
                m: 0,
                p: 0,
              }}
            >
              {Array.from(groupedEvents.entries()).map(([bucketKey, bucketEvents]) => (
                <Box key={bucketKey} sx={{ mb: 4 }}>
                  <Typography variant="overline" color="primary" sx={{ fontWeight: 'bold', ml: 2, display: 'block', mb: 2 }}>
                    {formatBucketLabel(bucketKey)} ({bucketEvents.length} EVENT{bucketEvents.length !== 1 ? "S" : ""})
                  </Typography>

                  {bucketEvents.map((event) => (
                    <TimelineItem key={event.id} onClick={() => handleEventClick(event.id)} sx={{ cursor: 'pointer', mb: 2 }}>
                      <TimelineOppositeContent color="text.secondary">
                        <Typography variant="caption" sx={{ fontWeight: 'bold' }}>
                          {formatDateTime(event.absolute_timestamp)}
                        </Typography>
                      </TimelineOppositeContent>
                      <TimelineSeparator>
                        <TimelineDot color={getConfidenceColorCode(event.ai_confidence_score)} variant={selectedEventId === event.id ? "filled" : "outlined"} />
                        <TimelineConnector />
                      </TimelineSeparator>
                      <TimelineContent>
                        <Paper 
                          elevation={selectedEventId === event.id ? 8 : 1} 
                          sx={{ 
                            p: 2, 
                            border: 1,
                            borderColor: selectedEventId === event.id ? 'primary.main' : 'divider',
                            backgroundColor: selectedEventId === event.id ? 'action.selected' : 'background.paper',
                            transition: 'all 0.2s',
                            '&:hover': {
                              borderColor: 'primary.light',
                              backgroundColor: 'action.hover',
                            }
                          }}
                        >
                          <Typography variant="body1" sx={{ fontWeight: 'bold' }}>
                            {event.event_description}
                          </Typography>
                          <Stack direction="row" spacing={1} sx={{ mt: 2, alignItems: 'center' }}>
                            <Chip 
                              size="small" 
                              label={`${(event.ai_confidence_score * 100).toFixed(0)}% AI SCORE`} 
                              color={getConfidenceColorCode(event.ai_confidence_score)}
                              variant="outlined"
                              sx={{ fontWeight: 'bold', fontSize: '0.65rem' }}
                            />
                            {event.source_type && (
                              <Chip 
                                size="small" 
                                icon={getSourceTypeIcon(event.source_type)} 
                                label={event.source_type} 
                                variant="outlined"
                                sx={{ textTransform: 'uppercase', fontSize: '0.65rem', fontWeight: 'bold' }}
                              />
                            )}
                          </Stack>
                        </Paper>
                      </TimelineContent>
                    </TimelineItem>
                  ))}
                </Box>
              ))}
            </Timeline>
          )}
        </Box>

        {/* Details Area */}
        {selectedEventId && (
          <Box sx={{ width: '40%', flexShrink: 0, overflowY: 'auto', p: 4, bgcolor: 'background.default' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
              <Typography variant="h6" sx={{ fontWeight: 'bold' }}>Source Evidence</Typography>
              <IconButton onClick={() => setSelectedEventId(null)}>
                <CloseIcon />
              </IconButton>
            </Box>

            {detailLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                <CircularProgress />
              </Box>
            ) : selectedDetail ? (
              <Stack spacing={3}>
                {/* Event Summary Card */}
                <Paper sx={{ p: 3 }} elevation={2}>
                  <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 'bold' }}>
                    Extracted Event
                  </Typography>
                  <Typography variant="body1" sx={{ mt: 1, lineHeight: 1.6 }}>
                    {selectedDetail.event_description}
                  </Typography>
                  <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 'bold' }}>
                      {formatDateTime(selectedDetail.absolute_timestamp)}
                    </Typography>
                    <Typography variant="caption" color={`${getConfidenceColorCode(selectedDetail.ai_confidence_score)}.main`} sx={{ fontWeight: 'bold' }}>
                      {(selectedDetail.ai_confidence_score * 100).toFixed(0)}% confidence
                    </Typography>
                  </Box>
                </Paper>

                {/* Source Verification */}
                <Box>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 2 }}>
                    {getSourceTypeIcon(selectedDetail.linked_source_type || null)}
                    <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                      Source {selectedDetail.linked_source_type === "document" ? "Document" : "Transcript"}
                    </Typography>
                  </Stack>
                  
                  {selectedDetail.linked_source_preview ? (
                    <>
                      <Paper variant="outlined" sx={{ p: 2, maxHeight: '50vh', overflow: 'auto', bgcolor: 'background.paper' }}>
                        <Typography variant="body2" component="pre" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', lineHeight: 1.6 }}>
                          {selectedDetail.linked_source_preview}
                        </Typography>
                      </Paper>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                        Review the source text above to verify the AI&apos;s temporal extraction.
                      </Typography>
                    </>
                  ) : (
                    <Paper sx={{ p: 3, textAlign: 'center', bgcolor: 'warning.light' }}>
                      <Typography variant="body2" color="warning.dark" sx={{ fontWeight: 'bold' }}>
                        Source content is not yet available. It may still be processing.
                      </Typography>
                    </Paper>
                  )}
                </Box>
              </Stack>
            ) : (
              <Typography align="center" color="text.secondary">
                Could not load event details.
              </Typography>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
}
