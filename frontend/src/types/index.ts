/**
 * TypeScript interfaces for the Legal Case Manager application.
 * These mirror the Pydantic schemas from the backend.
 */

// ── Auth ────────────────────────────────────────────────
export interface UserResponse {
  id: string;
  email: string;
  mfa_enabled: boolean;
  is_active: boolean;
  created_at: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
}

// ── Client ──────────────────────────────────────────────
export interface ClientResponse {
  id: string;
  name: string;
  contact_info: Record<string, unknown> | null;
  created_at: string;
}

export interface ClientCreate {
  name: string;
  contact_info?: Record<string, unknown> | null;
}

// ── Case ────────────────────────────────────────────────
export type CaseStatus =
  | "OPEN"
  | "IN_PROGRESS"
  | "PENDING_REVIEW"
  | "CLOSED"
  | "ARCHIVED";

export type CaseUserRole = "OWNER" | "ATTORNEY" | "PARALEGAL" | "VIEWER";

export interface CaseResponse {
  id: string;
  client_id: string;
  title: string;
  status: CaseStatus;
  description: string | null;
  filing_date: string | null;
  created_at: string;
}

export interface CaseDetailResponse extends CaseResponse {
  client: ClientResponse;
  document_count: number;
  communication_count: number;
  timeline_event_count: number;
}

export interface CaseCreate {
  client_id: string;
  title: string;
  description?: string;
  status?: CaseStatus;
  filing_date?: string;
}

// ── Document ────────────────────────────────────────────
export type DocStatus = "pending" | "processing" | "completed" | "failed";

export interface DocumentResponse {
  id: string;
  case_id: string;
  storage_uri: string;
  file_type: string;
  original_filename: string | null;
  file_hash: string | null;
  section_label: string | null;
  sort_order: number;
  status: DocStatus;
  status_message: string | null;
  raw_ocr_text: string | null;
  ocr_method: string | null;
  page_count: number | null;
  is_vectorized: boolean;
  summary: string | null;
  text_fingerprint: string | null;
  created_at: string;
}

export interface DocumentUploadResponse {
  id: string;
  message: string;
  processing: boolean;
  duplicate: boolean;
}

export interface DuplicateCandidate {
  document_id: string;
  original_filename: string | null;
  status: string;
  created_at: string;
  match_type: string;
  confidence: number;
}

export interface DuplicateGroup {
  reason: string;
  documents: DuplicateCandidate[];
}

export interface DuplicateScanResponse {
  case_id: string;
  duplicate_groups: DuplicateGroup[];
}

export interface DuplicateCleanupResponse {
  deleted_document_ids: string[];
  kept_document_id: string | null;
}

export interface DocumentOrganizationUpdate {
  document_id: string;
  section_label: string | null;
  sort_order: number;
}

export interface DocumentOrganizationResponse {
  case_id: string;
  documents: DocumentOrganizationUpdate[];
}

export interface DocumentSectionSuggestion {
  document_id: string;
  section_label: string;
  sort_order: number;
  reason: string | null;
}

export interface AIDocumentOrganizationResponse {
  case_id: string;
  documents: DocumentSectionSuggestion[];
}

export type AssistantRole = "user" | "assistant";

export interface AssistantMessage {
  role: AssistantRole;
  content: string;
}

export interface AssistantToolCall {
  tool_name: string;
  arguments: Record<string, unknown>;
  result_summary: string;
}

export interface AssistantChatRequest {
  messages: AssistantMessage[];
}

export interface AssistantChatResponse {
  message: AssistantMessage;
  tool_calls: AssistantToolCall[];
}

// ── Communication ───────────────────────────────────────
export type CommType = "EMAIL" | "CALL" | "NOTE";

export interface CommunicationResponse {
  id: string;
  case_id: string;
  comm_type: CommType;
  timestamp: string;
  sender: string | null;
  recipient: string | null;
  subject: string | null;
  transcript_body: string | null;
  is_vectorized: boolean;
  created_at: string;
}

export interface CommunicationCreate {
  case_id: string;
  comm_type: CommType;
  timestamp: string;
  sender?: string;
  recipient?: string;
  subject?: string;
  transcript_body?: string;
}

// ── Timeline ────────────────────────────────────────────
export interface TimelineEventResponse {
  id: string;
  case_id: string;
  absolute_timestamp: string;
  event_description: string;
  ai_confidence_score: number;
  source_type: string | null;
  linked_document_id: string | null;
  linked_communication_id: string | null;
  created_at: string;
}

export interface TimelineEventDetail extends TimelineEventResponse {
  linked_source_preview: string | null;
  linked_source_type: string | null;
}

// ── Search ──────────────────────────────────────────────
export interface SemanticSearchResult {
  source_id: string;
  source_type: string;
  text_chunk: string;
  similarity_score: number;
  metadata: Record<string, unknown> | null;
}
