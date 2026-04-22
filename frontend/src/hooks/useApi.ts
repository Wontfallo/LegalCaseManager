/**
 * Custom hooks for data fetching with React Query.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import type {
  CaseResponse,
  CaseDetailResponse,
  CaseCreate,
  ClientResponse,
  ClientCreate,
  DocumentResponse,
  DocumentUploadResponse,
  DocumentOrganizationResponse,
  AIDocumentOrganizationResponse,
  AssistantChatRequest,
  AssistantChatResponse,
  DuplicateScanResponse,
  DuplicateCleanupResponse,
  CommunicationResponse,
  CommunicationCreate,
  TimelineEventResponse,
  TimelineEventDetail,
  SemanticSearchResult,
  ChatSessionListItem,
  ChatSessionDetail,
  ChatSessionUpdateRequest,
  ChatSessionExportResponse,
} from "@/types";

// ── Cases ───────────────────────────────────────────────
export function useCases() {
  return useQuery<CaseResponse[]>({
    queryKey: ["cases"],
    queryFn: () => apiClient.get<CaseResponse[]>("/api/cases"),
  });
}

export function useCaseDetail(caseId: string) {
  return useQuery<CaseDetailResponse>({
    queryKey: ["cases", caseId],
    queryFn: () => apiClient.get<CaseDetailResponse>(`/api/cases/${caseId}`),
    enabled: !!caseId,
  });
}

export function useCreateCase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CaseCreate) =>
      apiClient.post<CaseResponse>("/api/cases", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cases"] });
    },
  });
}

// ── Clients ─────────────────────────────────────────────
export function useClients() {
  return useQuery<ClientResponse[]>({
    queryKey: ["clients"],
    queryFn: () => apiClient.get<ClientResponse[]>("/api/clients"),
  });
}

export function useCreateClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ClientCreate) =>
      apiClient.post<ClientResponse>("/api/clients", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
    },
  });
}

// ── Documents ───────────────────────────────────────────
export function useCaseDocuments(caseId: string) {
  const query = useQuery<DocumentResponse[]>({
    queryKey: ["cases", caseId, "documents"],
    queryFn: () =>
      apiClient.get<DocumentResponse[]>(`/api/cases/${caseId}/documents`),
    enabled: !!caseId,
    // Poll every 3s while any document is still pending/processing
    refetchInterval: (query) => {
      const docs = query.state.data;
      if (!docs) return false;
      const hasProcessing = docs.some(
        (d) => d.status === "pending" || d.status === "processing"
      );
      return hasProcessing ? 3000 : false;
    },
  });
  return query;
}

export function useUploadDocument(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) =>
      apiClient.uploadFile<DocumentUploadResponse>("/api/upload", file, {
        case_id: caseId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["cases", caseId, "documents"],
      });
      queryClient.invalidateQueries({ queryKey: ["cases", caseId] });
    },
  });
}

export function useDeleteDocument(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) =>
      apiClient.delete<void>(`/api/documents/${documentId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cases", caseId, "documents"] });
      queryClient.invalidateQueries({ queryKey: ["cases", caseId] });
      queryClient.invalidateQueries({ queryKey: ["cases", caseId, "timeline"] });
    },
  });
}

export function useRetryDocument(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) =>
      apiClient.post<DocumentUploadResponse>(`/api/documents/${documentId}/retry`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cases", caseId, "documents"] });
      queryClient.invalidateQueries({ queryKey: ["cases", caseId] });
      queryClient.invalidateQueries({ queryKey: ["cases", caseId, "timeline"] });
    },
  });
}

export function useDocument(documentId: string) {
  return useQuery<DocumentResponse>({
    queryKey: ["documents", documentId],
    queryFn: () =>
      apiClient.get<DocumentResponse>(`/api/documents/${documentId}`),
    enabled: !!documentId,
  });
}

export function useDocumentDuplicates(caseId: string) {
  return useQuery<DuplicateScanResponse>({
    queryKey: ["cases", caseId, "document-duplicates"],
    queryFn: () =>
      apiClient.get<DuplicateScanResponse>(
        `/api/cases/${caseId}/documents/duplicates`
      ),
    enabled: !!caseId,
    staleTime: 0,
  });
}

export function useCleanupDuplicateDocuments(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      case_id: string;
      document_ids: string[];
      keep_document_id?: string | null;
    }) =>
      apiClient.post<DuplicateCleanupResponse>(
        "/api/documents/duplicates/cleanup",
        data
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cases", caseId, "documents"] });
      queryClient.invalidateQueries({ queryKey: ["cases", caseId, "document-duplicates"] });
      queryClient.invalidateQueries({ queryKey: ["cases", caseId] });
      queryClient.invalidateQueries({ queryKey: ["cases", caseId, "timeline"] });
    },
  });
}

export function useUpdateDocumentOrganization(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      case_id: string;
      documents: { document_id: string; section_label: string | null; sort_order: number }[];
    }) =>
      apiClient.post<DocumentOrganizationResponse>(
        `/api/cases/${caseId}/documents/organize`,
        data
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cases", caseId, "documents"] });
      queryClient.invalidateQueries({ queryKey: ["cases", caseId] });
    },
  });
}

export function useAIOrganizeDocuments(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiClient.post<AIDocumentOrganizationResponse>(
        `/api/cases/${caseId}/documents/organize/ai`
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cases", caseId, "documents"] });
      queryClient.invalidateQueries({ queryKey: ["cases", caseId] });
    },
  });
}

export function useCaseAssistantChat(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: AssistantChatRequest) =>
      apiClient.post<AssistantChatResponse>(
        `/api/cases/${caseId}/assistant/chat`,
        data
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cases", caseId, "documents"] });
      queryClient.invalidateQueries({ queryKey: ["cases", caseId] });
      queryClient.invalidateQueries({ queryKey: ["cases", caseId, "document-duplicates"] });
    },
  });
}

export function useResummarizeDocument(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) =>
      apiClient.post<{ document_id: string; summary: string | null; status: string }>(
        `/api/documents/${documentId}/resummarize`
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cases", caseId, "documents"] });
    },
  });
}

export function useResummarizeAll(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiClient.post<{ message: string; document_count: number }>(
        `/api/cases/${caseId}/documents/resummarize-all`
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cases", caseId, "documents"] });
    },
  });
}

export function useReOCRAll(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiClient.post<{ message: string; document_count: number }>(
        `/api/cases/${caseId}/documents/reocr-all`
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cases", caseId, "documents"] });
    },
  });
}

export function useScanImages(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiClient.post<{ message: string; document_count: number }>(
        `/api/cases/${caseId}/documents/scan-images`
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cases", caseId, "documents"] });
    },
  });
}

// ── Communications ──────────────────────────────────────
export function useCaseCommunications(caseId: string) {
  return useQuery<CommunicationResponse[]>({
    queryKey: ["cases", caseId, "communications"],
    queryFn: () =>
      apiClient.get<CommunicationResponse[]>(
        `/api/cases/${caseId}/communications`
      ),
    enabled: !!caseId,
  });
}

export function useCreateCommunication(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CommunicationCreate) =>
      apiClient.post<CommunicationResponse>(
        `/api/cases/${caseId}/communications`,
        data
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["cases", caseId, "communications"],
      });
      queryClient.invalidateQueries({
        queryKey: ["cases", caseId, "timeline"],
      });
      queryClient.invalidateQueries({ queryKey: ["cases", caseId] });
    },
  });
}

// ── Timeline ────────────────────────────────────────────
export function useCaseTimeline(
  caseId: string,
  options?: { minConfidence?: number; startDate?: string; endDate?: string }
) {
  return useQuery<TimelineEventResponse[]>({
    queryKey: ["cases", caseId, "timeline", options],
    queryFn: () =>
      apiClient.get<TimelineEventResponse[]>(
        `/api/cases/${caseId}/timeline`,
        {
          min_confidence: options?.minConfidence,
          start_date: options?.startDate,
          end_date: options?.endDate,
        }
      ),
    enabled: !!caseId,
  });
}

export function useTimelineEventDetail(caseId: string, eventId: string) {
  return useQuery<TimelineEventDetail>({
    queryKey: ["cases", caseId, "timeline", eventId],
    queryFn: () =>
      apiClient.get<TimelineEventDetail>(
        `/api/cases/${caseId}/timeline/${eventId}`
      ),
    enabled: !!caseId && !!eventId,
  });
}

// ── Search ──────────────────────────────────────────────
export function useSemanticSearch() {
  return useMutation({
    mutationFn: (data: { query: string; case_id: string; top_k?: number }) =>
      apiClient.post<SemanticSearchResult[]>("/api/search", data),
  });
}

// ── Google Integration ──────────────────────────────────
export function useGoogleStatus() {
  return useQuery<{ connected: boolean }>({
    queryKey: ["google", "status"],
    queryFn: () => apiClient.get<{ connected: boolean }>("/api/integrations/google/status"),
  });
}

export function useGoogleConnect() {
  return useMutation({
    mutationFn: () => apiClient.get<{ url: string }>("/api/integrations/google/connect"),
  });
}

export function useBackupToDrive(caseId: string) {
  return useMutation({
    mutationFn: () => apiClient.post<{ message: string; document_count: number }>(`/api/cases/${caseId}/documents/backup-to-drive`),
  });
}

// ── Chat Sessions ────────────────────────────────────────
export function useChatSessions(caseId: string) {
  return useQuery<ChatSessionListItem[]>({
    queryKey: ["cases", caseId, "chat-sessions"],
    queryFn: () =>
      apiClient.get<ChatSessionListItem[]>(`/api/cases/${caseId}/chat-sessions`),
    enabled: !!caseId,
  });
}

export function useSearchChatSessions(caseId: string, query: string) {
  return useQuery<ChatSessionListItem[]>({
    queryKey: ["cases", caseId, "chat-sessions", "search", query],
    queryFn: () =>
      apiClient.get<ChatSessionListItem[]>(
        `/api/cases/${caseId}/chat-sessions/search`,
        { q: query }
      ),
    enabled: !!caseId && query.trim().length > 0,
  });
}

export function useChatSessionDetail(caseId: string, sessionId: string | null) {
  return useQuery<ChatSessionDetail>({
    queryKey: ["cases", caseId, "chat-sessions", sessionId],
    queryFn: () =>
      apiClient.get<ChatSessionDetail>(
        `/api/cases/${caseId}/chat-sessions/${sessionId}`
      ),
    enabled: !!caseId && !!sessionId,
  });
}

export function useCreateChatSession(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiClient.post<ChatSessionListItem>(`/api/cases/${caseId}/chat-sessions`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cases", caseId, "chat-sessions"] });
    },
  });
}

export function useUpdateChatSession(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, data }: { sessionId: string; data: ChatSessionUpdateRequest }) =>
      apiClient.patch<ChatSessionListItem>(
        `/api/cases/${caseId}/chat-sessions/${sessionId}`,
        data
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cases", caseId, "chat-sessions"] });
    },
  });
}

export function useDeleteChatSession(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      apiClient.delete<void>(`/api/cases/${caseId}/chat-sessions/${sessionId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cases", caseId, "chat-sessions"] });
    },
  });
}

export function useExportChatToDocument(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      apiClient.post<ChatSessionExportResponse>(
        `/api/cases/${caseId}/chat-sessions/${sessionId}/export`
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cases", caseId, "documents"] });
      queryClient.invalidateQueries({ queryKey: ["cases", caseId] });
    },
  });
}
