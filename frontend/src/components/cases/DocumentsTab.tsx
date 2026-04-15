"use client";

import { useEffect, useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
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
} from "@/hooks/useApi";
import { apiClient } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";
import type { DocStatus, DocumentResponse, DuplicateGroup } from "@/types";

interface Props {
  caseId: string;
}

function StatusBadge({ status }: { status: DocStatus }) {
  const styles: Record<DocStatus, string> = {
    pending: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    processing: "bg-amber-100 text-amber-700 animate-pulse dark:bg-amber-900/40 dark:text-amber-400",
    completed: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
    failed: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
  };
  const labels: Record<DocStatus, string> = {
    pending: "Pending",
    processing: "Processing",
    completed: "Completed",
    failed: "Failed",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${styles[status]}`}
    >
      {labels[status]}
    </span>
  );
}

export default function DocumentsTab({ caseId }: Props) {
  const queryClient = useQueryClient();
  const collapsedSectionsStorageKey = `legalcm:documents:${caseId}:collapsed-sections`;
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [compareDocId, setCompareDocId] = useState<string | null>(null);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [selectedDuplicateIds, setSelectedDuplicateIds] = useState<string[]>([]);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [newSectionName, setNewSectionName] = useState("");
  const [bulkTargetSection, setBulkTargetSection] = useState("Ungrouped");
  const [draggingDocId, setDraggingDocId] = useState<string | null>(null);

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

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = window.localStorage.getItem(collapsedSectionsStorageKey);
      if (!saved) return;
      const parsed = JSON.parse(saved) as Record<string, boolean>;
      setCollapsedSections(parsed);
    } catch {
      window.localStorage.removeItem(collapsedSectionsStorageKey);
    }
  }, [collapsedSectionsStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      collapsedSectionsStorageKey,
      JSON.stringify(collapsedSections)
    );
  }, [collapsedSections, collapsedSectionsStorageKey]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    // Validate file type
    const allowedTypes = [
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/tiff",
      "image/bmp",
    ];

    const validFiles = files.filter((file) => allowedTypes.includes(file.type));
    const invalidFiles = files.filter((file) => !allowedTypes.includes(file.type));

    if (invalidFiles.length > 0) {
      toast.error(
        `Skipped ${invalidFiles.length} unsupported file${invalidFiles.length === 1 ? "" : "s"}.`
      );
    }

    if (validFiles.length === 0) {
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

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

  const toggleSectionCollapsed = (sectionName: string) => {
    setCollapsedSections((current) => ({
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
    <div className="rounded-lg border surface p-4">
      <div className="mb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-body">{doc.original_filename}</p>
              <StatusBadge status={doc.status} />
            </div>
            <p className="text-xs text-muted mt-1">
              {title} | Type: {doc.file_type}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                try {
                  const { blob, contentType } = await apiClient.getBlob(
                    `/api/documents/${doc.id}/file`
                  );
                  const fileBlob =
                    contentType && blob.type !== contentType
                      ? new Blob([blob], { type: contentType })
                      : blob;
                  const objectUrl = URL.createObjectURL(fileBlob);
                  window.open(objectUrl, "_blank", "noopener,noreferrer");
                  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
                } catch (err: any) {
                  toast.error(
                    err?.response?.data?.detail || "Failed to open original document."
                  );
                }
              }}
              className="text-xs text-brand-600 hover:text-brand-800"
            >
              Open Original
            </button>
            <button
              onClick={async () => {
                try {
                  const { blob, filename } = await apiClient.getBlob(
                    `/api/documents/${doc.id}/file`
                  );
                  const objectUrl = URL.createObjectURL(blob);
                  const anchor = document.createElement("a");
                  anchor.href = objectUrl;
                  anchor.download = filename || doc.original_filename || `document-${doc.id}`;
                  document.body.appendChild(anchor);
                  anchor.click();
                  anchor.remove();
                  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
                } catch (err: any) {
                  toast.error(
                    err?.response?.data?.detail || "Failed to download original document."
                  );
                }
              }}
              className="text-xs text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            >
              Download Original
            </button>
          </div>
        </div>
      </div>

      {doc.status === "failed" && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-4 dark:bg-red-950/30 dark:border-red-900">
          <p className="text-sm font-medium text-red-800 dark:text-red-300">Processing Failed</p>
          <p className="mt-1 text-sm text-red-700 dark:text-red-400">
            {doc.status_message || "An unknown error occurred during processing."}
          </p>
        </div>
      )}

      {(doc.status === "pending" || doc.status === "processing") && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-center dark:bg-amber-950/30 dark:border-amber-800">
          <div className="animate-spin h-6 w-6 rounded-full border-4 border-amber-500 border-t-transparent mx-auto mb-2" />
          <p className="text-sm text-amber-700 dark:text-amber-400">
            {doc.status_message || "OCR processing in progress..."}
          </p>
        </div>
      )}

      {doc.status === "completed" && (
        <>
          {doc.summary && (
            <div className="rounded-lg bg-blue-50 border border-blue-200 p-4 mb-3 dark:bg-blue-950/30 dark:border-blue-900">
              <h4 className="text-xs font-semibold text-blue-800 dark:text-blue-300 uppercase tracking-wide mb-2">
                AI Summary
              </h4>
              <p className="text-sm text-blue-900 dark:text-blue-200 leading-relaxed">{doc.summary}</p>
            </div>
          )}
          {doc.raw_ocr_text ? (
            <div>
              <h4 className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">
                Extracted Text
              </h4>
              <div className="rounded-lg surface-muted p-4 max-h-[50vh] overflow-auto custom-scrollbar">
                <pre className="text-xs text-body whitespace-pre-wrap font-mono leading-relaxed">
                  {doc.raw_ocr_text}
                </pre>
              </div>
            </div>
          ) : (
            <div className="rounded-lg surface-muted p-4 text-center">
              <p className="text-sm text-muted">No text was extracted from this document.</p>
            </div>
          )}
        </>
      )}
    </div>
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
    setCollapsedSections((current) => ({ ...current, [sectionName]: false }));
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
    <div className="h-full flex">
      {/* Documents List */}
      <div
        className={`${
          selectedDoc ? "w-1/2" : "w-full"
        } border-r border-slate-200 dark:border-slate-800 overflow-auto transition-all duration-300`}
      >
        <div className="px-8 py-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-semibold text-heading">
                Documents ({documents?.length || 0})
              </h3>
              <p className="mt-1 text-xs text-muted">
                Upload PDFs or images. Use AI Organize to auto-categorize.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                value={newSectionName}
                onChange={(e) => setNewSectionName(e.target.value)}
                placeholder="New section"
                className="rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 px-3 py-2 text-sm"
              />
              <button
                onClick={() => void handleCreateSection()}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-body hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                Add Section
              </button>
              <select
                value={bulkTargetSection}
                onChange={(e) => setBulkTargetSection(e.target.value)}
                className="rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 px-3 py-2 text-sm"
              >
                {allSectionNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <button
                onClick={() => void handleBulkMove()}
                disabled={selectedDocumentIds.length === 0}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-body hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                Move Selected
              </button>
              <button
                onClick={async () => {
                  await queryClient.invalidateQueries({
                    queryKey: ["cases", caseId, "document-duplicates"],
                  });
                  setShowDuplicates(true);
                }}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-body hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                {showDuplicates ? "Refresh Duplicates" : "Scan Duplicates"}
              </button>
              <button
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
                className="mr-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-body hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                {aiOrganizeMutation.isPending ? "AI Organizing..." : "AI Organize"}
              </button>
              <button
                onClick={async () => {
                  try {
                    const result = await resummarizeAllMutation.mutateAsync();
                    toast.success(result.message);
                  } catch (err: any) {
                    toast.error(err?.response?.data?.detail || "Failed to re-summarize.");
                  }
                }}
                disabled={resummarizeAllMutation.isPending}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-body hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                {resummarizeAllMutation.isPending ? "Summarizing..." : "Re-summarize All"}
              </button>
              <button
                onClick={async () => {
                  if (!window.confirm("Re-run OCR on ALL documents? This will reprocess everything from scratch.")) return;
                  try {
                    const result = await reOCRAllMutation.mutateAsync();
                    toast.success(result.message);
                  } catch (err: any) {
                    toast.error(err?.response?.data?.detail || "Failed to re-scan.");
                  }
                }}
                disabled={reOCRAllMutation.isPending}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-body hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                {reOCRAllMutation.isPending ? "Re-scanning..." : "Re-scan All (OCR)"}
              </button>
              <button
                onClick={async () => {
                  try {
                    const result = await scanImagesMutation.mutateAsync();
                    toast.success(result.message);
                  } catch (err: any) {
                    toast.error(err?.response?.data?.detail || "No images found or scan failed.");
                  }
                }}
                disabled={scanImagesMutation.isPending}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-body hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                {scanImagesMutation.isPending ? "Scanning..." : "Scan Images (Vision)"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleUpload}
                multiple
                accept=".pdf,.png,.jpg,.jpeg,.tiff,.bmp"
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadMutation.isPending || uploadingCount > 0}
                className="btn-primary"
              >
                {uploadingCount > 0
                  ? `Uploading ${uploadingCount}...`
                  : "+ Upload Documents"}
              </button>
            </div>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin h-6 w-6 rounded-full border-4 border-brand-600 border-t-transparent" />
            </div>
          ) : !documents || documents.length === 0 ? (
            <div className="text-center py-12">
              <svg
                className="mx-auto h-10 w-10 text-slate-300 dark:text-slate-600"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                />
              </svg>
              <p className="mt-3 text-sm text-muted">
                No documents yet. Upload one or more PDFs or images to start.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {showDuplicates && duplicateScan && duplicateScan.duplicate_groups.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <h4 className="text-sm font-semibold text-amber-900 dark:text-amber-300">
                        Possible Duplicates ({duplicateScan.duplicate_groups.length} group{duplicateScan.duplicate_groups.length === 1 ? "" : "s"})
                      </h4>
                      <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                        Compare documents, then use bulk actions or resolve individually.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => {
                          setShowDuplicates(false);
                          setSelectedDuplicateIds([]);
                        }}
                        className="rounded-md border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-body hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        Dismiss
                      </button>
                      <button
                        onClick={() => void handleDeleteSelectedDuplicates()}
                        disabled={
                          selectedDuplicateIds.length === 0 ||
                          cleanupDuplicatesMutation.isPending
                        }
                        className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        Delete Selected ({selectedDuplicateIds.length})
                      </button>
                      <button
                        onClick={async () => {
                          const allDupeIds = duplicateScan.duplicate_groups.flatMap((g) =>
                            g.documents.slice(1).map((d) => d.document_id)
                          );
                          if (allDupeIds.length === 0) return;
                          if (
                            !window.confirm(
                              `Delete ${allDupeIds.length} duplicate${allDupeIds.length === 1 ? "" : "s"} across all groups? The first document in each group will be kept.`
                            )
                          ) return;
                          try {
                            await cleanupDuplicatesMutation.mutateAsync({
                              case_id: caseId,
                              document_ids: allDupeIds,
                              keep_document_id: null,
                            });
                            setSelectedDuplicateIds([]);
                            setShowDuplicates(false);
                            toast.success(`Deleted ${allDupeIds.length} duplicate${allDupeIds.length === 1 ? "" : "s"}.`);
                          } catch (err: any) {
                            toast.error(err?.response?.data?.detail || "Failed to delete duplicates.");
                          }
                        }}
                        disabled={cleanupDuplicatesMutation.isPending}
                        className="rounded-md bg-red-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-800 disabled:opacity-50"
                      >
                        Delete All Duplicates
                      </button>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {duplicateScan.duplicate_groups.map((group, index) => {
                      const groupDocIds = group.documents.map((d) => d.document_id);
                      const allGroupSelected = groupDocIds.every((id) => selectedDuplicateIds.includes(id));
                      const someGroupSelected = groupDocIds.some((id) => selectedDuplicateIds.includes(id));
                      return (
                      <div key={`${group.reason}-${index}`} className="rounded-md border border-amber-200 bg-white p-3 dark:border-amber-800 dark:bg-slate-900">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={allGroupSelected}
                              ref={(el) => { if (el) el.indeterminate = someGroupSelected && !allGroupSelected; }}
                              onChange={() => {
                                if (allGroupSelected) {
                                  setSelectedDuplicateIds((c) => c.filter((id) => !groupDocIds.includes(id)));
                                } else {
                                  setSelectedDuplicateIds((c) => [...new Set([...c, ...groupDocIds])]);
                                }
                              }}
                            />
                            <p className="text-xs font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
                              {group.reason}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {group.documents.length >= 2 && (
                              <button
                                onClick={() => handleCompareDuplicate(group.documents[0].document_id, group)}
                                className="text-xs font-medium text-brand-600 hover:text-brand-800"
                              >
                                Compare
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="mt-2 space-y-2">
                          {group.documents.map((candidate) => (
                            <div key={candidate.document_id} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 dark:border-slate-700 p-2 text-xs text-body">
                              <label className="flex items-center gap-2 min-w-0 flex-1">
                                <input
                                  type="checkbox"
                                  checked={selectedDuplicateIds.includes(candidate.document_id)}
                                  onChange={() =>
                                    toggleDuplicateSelection(candidate.document_id)
                                  }
                                />
                                <span className="truncate">
                                  {candidate.original_filename || candidate.document_id}
                                </span>
                              </label>
                              <div className="flex items-center gap-3">
                                <span className="whitespace-nowrap text-muted">
                                  {(candidate.confidence * 100).toFixed(0)}% match
                                </span>
                                <button
                                  onClick={() => handleOpenDuplicate(candidate.document_id)}
                                  className="text-xs text-brand-600 hover:text-brand-800"
                                >
                                  Open
                                </button>
                                <button
                                  onClick={() =>
                                    void handleKeepOneFromGroup(
                                      group,
                                      candidate.document_id
                                    )
                                  }
                                  className="text-xs text-emerald-700 hover:text-emerald-900"
                                >
                                  Keep This
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {showDuplicates && duplicateScan && duplicateScan.duplicate_groups.length === 0 && (
                <div className="rounded-lg border surface-muted p-4 text-sm text-muted flex items-center justify-between">
                  <span>No duplicate groups found.</span>
                  <button
                    onClick={() => setShowDuplicates(false)}
                    className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {sectionEntries.map(([sectionName, sectionDocs]) => (
                <div key={sectionName} className="space-y-3">
                  <div
                    className="sticky top-0 z-10 rounded-lg surface-inset px-3 py-2"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const droppedDocId = e.dataTransfer.getData("text/plain");
                      if (droppedDocId) {
                        void handleDropDocument(droppedDocId, sectionName, sectionDocs.length);
                      }
                    }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => toggleSectionCollapsed(sectionName)}
                          className="text-xs text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                        >
                          {collapsedSections[sectionName] ? "Expand" : "Collapse"}
                        </button>
                        <h4 className="text-sm font-semibold text-heading">
                          {sectionName}
                        </h4>
                        <button
                          onClick={() => void handleRenameSection(sectionName)}
                          className="text-xs text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                        >
                          Rename
                        </button>
                      </div>
                      <span className="text-xs text-muted">
                        {sectionDocs.length} doc{sectionDocs.length === 1 ? "" : "s"}
                      </span>
                    </div>
                  </div>

                  {!collapsedSections[sectionName] && sectionDocs.map((doc, index) => (
                    <div
                      key={doc.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", doc.id);
                        setDraggingDocId(doc.id);
                      }}
                      onDragEnd={() => setDraggingDocId(null)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const droppedDocId = e.dataTransfer.getData("text/plain");
                        if (droppedDocId) {
                          void handleDropDocument(droppedDocId, sectionName, index);
                        }
                      }}
                      className={`card hover:shadow-md transition-shadow ${
                        selectedDocId === doc.id ? "ring-2 ring-brand-500" : ""
                      } ${draggingDocId === doc.id ? "opacity-60" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <label className="mt-1 flex items-center">
                          <input
                            type="checkbox"
                            checked={selectedDocumentIds.includes(doc.id)}
                            onChange={() => toggleDocumentSelection(doc.id)}
                          />
                        </label>
                        <button
                          onClick={() =>
                            setSelectedDocId(selectedDocId === doc.id ? null : doc.id)
                          }
                          className="flex-1 min-w-0 text-left"
                        >
                          <p className="text-base font-semibold text-heading leading-snug">
                            {doc.original_filename || doc.storage_uri}
                          </p>
                          {doc.summary && (
                            <p className="mt-2 text-sm text-body line-clamp-3 leading-relaxed">
                              {doc.summary}
                            </p>
                          )}
                          <div className="mt-1 flex items-center gap-3 text-xs text-muted">
                            <span className="uppercase font-medium">{doc.file_type}</span>
                            {doc.page_count && <span>{doc.page_count} page(s)</span>}
                            {doc.is_vectorized && (
                              <span className="badge-green">Indexed</span>
                            )}
                          </div>
                          {doc.status === "failed" && doc.status_message && (
                            <p className="mt-1 text-xs text-red-600">
                              {doc.status_message}
                            </p>
                          )}
                          <p className="mt-1 text-xs text-faint">
                            Uploaded {formatDateTime(doc.created_at)}
                          </p>
                        </button>
                        <div className="flex flex-col items-end gap-2">
                          <StatusBadge status={doc.status} />
                          <div className="flex items-center gap-2">
                            <select
                              value={doc.section_label || "Ungrouped"}
                              onChange={(e) =>
                                void saveDocumentPlacement(
                                  doc,
                                  e.target.value === "Ungrouped" ? null : e.target.value,
                                  doc.sort_order
                                )
                              }
                              className="rounded border border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 px-2 py-1 text-xs"
                            >
                              {Array.from(new Set(["Ungrouped", ...sectionEntries.map(([name]) => name)])).map((name) => (
                                <option key={name} value={name}>
                                  {name}
                                </option>
                              ))}
                            </select>
                            {index > 0 && (
                              <button
                                onClick={() =>
                                  void saveDocumentPlacement(doc, doc.section_label, Math.max(0, doc.sort_order - 1))
                                }
                              className="text-xs text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                              >
                                Up
                              </button>
                            )}
                            {index < sectionDocs.length - 1 && (
                              <button
                                onClick={() =>
                                  void saveDocumentPlacement(doc, doc.section_label, doc.sort_order + 1)
                                }
                              className="text-xs text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                              >
                                Down
                              </button>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {(doc.status === "failed" || doc.status === "pending") && (
                              <button
                                onClick={() => handleRetryDocument(doc.id)}
                                disabled={retryMutation.isPending}
                                className="text-xs text-brand-600 hover:text-brand-800"
                              >
                                Retry
                              </button>
                            )}
                            {doc.status === "completed" && (
                              <button
                                onClick={async () => {
                                  try {
                                    await resummarizeDocMutation.mutateAsync(doc.id);
                                    toast.success("Summary updated.");
                                  } catch (err: any) {
                                    toast.error(err?.response?.data?.detail || "Failed to re-summarize.");
                                  }
                                }}
                                disabled={resummarizeDocMutation.isPending}
                                className="text-xs text-brand-600 hover:text-brand-800"
                              >
                                Re-summarize
                              </button>
                            )}
                            <button
                              onClick={() =>
                                handleDeleteDocument(
                                  doc.id,
                                  doc.original_filename || doc.storage_uri
                                )
                              }
                              disabled={deleteMutation.isPending}
                              className="text-xs text-red-600 hover:text-red-800"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Document Preview Panel */}
      {selectedDoc && (
        <div className="w-1/2 overflow-auto evidence-panel-enter bg-slate-50 dark:bg-slate-900">
          <div className="px-6 py-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-heading">
                {compareDoc ? "Document Comparison" : "Document Preview"}
              </h3>
              <button
                onClick={() => {
                  setSelectedDocId(null);
                  setCompareDocId(null);
                }}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
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
            {compareDoc ? (
              <div className="grid grid-cols-2 gap-4">
                {renderDocumentPreview(selectedDoc, "Primary")}
                {renderDocumentPreview(compareDoc, "Comparison")}
              </div>
            ) : (
              renderDocumentPreview(selectedDoc, "Primary")
            )}
          </div>
        </div>
      )}
    </div>
  );
}
