"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { useCaseCommunications, useCreateCommunication } from "@/hooks/useApi";
import { formatDateTime, getCommTypeLabel, truncate } from "@/lib/utils";
import type { CommType, CommunicationCreate } from "@/types";

interface Props {
  caseId: string;
}

export default function CommunicationsTab({ caseId }: Props) {
  const { data: communications, isLoading } = useCaseCommunications(caseId);
  const createComm = useCreateCommunication(caseId);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedCommId, setSelectedCommId] = useState<string | null>(null);

  const [formData, setFormData] = useState<{
    comm_type: CommType;
    sender: string;
    recipient: string;
    subject: string;
    transcript_body: string;
  }>({
    comm_type: "NOTE",
    sender: "",
    recipient: "",
    subject: "",
    transcript_body: "",
  });

  const handleCreate = async () => {
    if (!formData.transcript_body.trim()) {
      toast.error("Content is required.");
      return;
    }
    try {
      await createComm.mutateAsync({
        case_id: caseId,
        comm_type: formData.comm_type,
        timestamp: new Date().toISOString(),
        sender: formData.sender || undefined,
        recipient: formData.recipient || undefined,
        subject: formData.subject || undefined,
        transcript_body: formData.transcript_body,
      });
      toast.success("Communication logged.");
      setShowCreate(false);
      setFormData({
        comm_type: "NOTE",
        sender: "",
        recipient: "",
        subject: "",
        transcript_body: "",
      });
    } catch (err: any) {
      toast.error(
        err?.response?.data?.detail || "Failed to create communication."
      );
    }
  };

  const selectedComm = communications?.find((c) => c.id === selectedCommId);

  const getCommIcon = (type: string) => {
    switch (type) {
      case "EMAIL":
        return (
          <svg
            className="h-5 w-5 text-blue-500"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
            />
          </svg>
        );
      case "CALL":
        return (
          <svg
            className="h-5 w-5 text-emerald-500"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"
            />
          </svg>
        );
      default:
        return (
          <svg
            className="h-5 w-5 text-amber-500"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z"
            />
          </svg>
        );
    }
  };

  return (
    <div className="h-full flex">
      {/* Communications List */}
      <div
        className={`${
          selectedComm ? "w-1/2" : "w-full"
        } border-r border-slate-200 dark:border-slate-800 overflow-auto transition-all duration-300`}
      >
        <div className="px-8 py-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-heading">
              Communication Logs ({communications?.length || 0})
            </h3>
            <button
              onClick={() => setShowCreate(true)}
              className="btn-primary"
            >
              + Add Note
            </button>
          </div>

          {/* Create Note Modal */}
          {showCreate && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
              <div className="card w-full max-w-lg mx-4">
                <h2 className="text-lg font-semibold text-heading mb-4">
                  Add Communication Note
                </h2>
                <div className="space-y-4">
                  <div>
                    <label className="block label-text mb-1">
                      Type
                    </label>
                    <select
                      value={formData.comm_type}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          comm_type: e.target.value as CommType,
                        })
                      }
                      className="input-field"
                    >
                      <option value="NOTE">Note</option>
                      <option value="EMAIL">Email</option>
                      <option value="CALL">Phone Call</option>
                    </select>
                  </div>
                  <div>
                    <label className="block label-text mb-1">
                      Subject
                    </label>
                    <input
                      type="text"
                      value={formData.subject}
                      onChange={(e) =>
                        setFormData({ ...formData, subject: e.target.value })
                      }
                      className="input-field"
                      placeholder="Brief subject..."
                    />
                  </div>
                  <div>
                    <label className="block label-text mb-1">
                      Content
                    </label>
                    <textarea
                      value={formData.transcript_body}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          transcript_body: e.target.value,
                        })
                      }
                      className="input-field min-h-[150px]"
                      placeholder="Communication content or transcript..."
                    />
                  </div>
                </div>
                <div className="mt-6 flex justify-end gap-3">
                  <button
                    onClick={() => setShowCreate(false)}
                    className="btn-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreate}
                    disabled={createComm.isPending}
                    className="btn-primary"
                  >
                    {createComm.isPending ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin h-6 w-6 rounded-full border-4 border-brand-600 border-t-transparent" />
            </div>
          ) : !communications || communications.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-muted">
                No communications logged yet.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {communications.map((comm) => (
                <button
                  key={comm.id}
                  onClick={() =>
                    setSelectedCommId(
                      selectedCommId === comm.id ? null : comm.id
                    )
                  }
                  className={`w-full text-left card hover:shadow-md transition-shadow ${
                    selectedCommId === comm.id
                      ? "ring-2 ring-brand-500"
                      : ""
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">{getCommIcon(comm.comm_type)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-muted uppercase">
                          {getCommTypeLabel(comm.comm_type)}
                        </span>
                        {comm.is_vectorized && (
                          <span className="badge-green text-[10px]">
                            Indexed
                          </span>
                        )}
                      </div>
                      {comm.subject && (
                        <p className="text-sm font-medium text-heading mt-0.5">
                          {comm.subject}
                        </p>
                      )}
                      {comm.transcript_body && (
                        <p className="text-xs text-muted mt-1 line-clamp-2">
                          {truncate(comm.transcript_body, 200)}
                        </p>
                      )}
                      <div className="mt-1.5 flex items-center gap-3 text-xs text-faint">
                        {comm.sender && <span>From: {comm.sender}</span>}
                        <span>{formatDateTime(comm.timestamp)}</span>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Communication Preview Panel */}
      {selectedComm && (
        <div className="w-1/2 overflow-auto evidence-panel-enter">
          <div className="px-6 py-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-heading">
                Communication Detail
              </h3>
              <button
                onClick={() => setSelectedCommId(null)}
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
            <dl className="space-y-3 mb-4">
              <div>
                <dt className="text-xs font-medium text-muted uppercase">
                  Type
                </dt>
                <dd className="text-sm text-heading">
                  {getCommTypeLabel(selectedComm.comm_type)}
                </dd>
              </div>
              {selectedComm.subject && (
                <div>
                  <dt className="text-xs font-medium text-muted uppercase">
                    Subject
                  </dt>
                  <dd className="text-sm text-heading">
                    {selectedComm.subject}
                  </dd>
                </div>
              )}
              {selectedComm.sender && (
                <div>
                  <dt className="text-xs font-medium text-muted uppercase">
                    From
                  </dt>
                  <dd className="text-sm text-heading">
                    {selectedComm.sender}
                  </dd>
                </div>
              )}
              {selectedComm.recipient && (
                <div>
                  <dt className="text-xs font-medium text-muted uppercase">
                    To
                  </dt>
                  <dd className="text-sm text-heading">
                    {selectedComm.recipient}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-xs font-medium text-muted uppercase">
                  Timestamp
                </dt>
                <dd className="text-sm text-heading">
                  {formatDateTime(selectedComm.timestamp)}
                </dd>
              </div>
            </dl>
            {selectedComm.transcript_body && (
              <div className="rounded-lg surface-muted p-4 max-h-[60vh] overflow-auto custom-scrollbar">
                <pre className="text-xs text-body whitespace-pre-wrap font-mono leading-relaxed">
                  {selectedComm.transcript_body}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
