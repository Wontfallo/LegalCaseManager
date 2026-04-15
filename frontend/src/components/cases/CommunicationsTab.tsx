"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { useCaseCommunications, useCreateCommunication } from "@/hooks/useApi";
import { formatDateTime, getCommTypeLabel, truncate, cn } from "@/lib/utils";
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
    <div className="h-full flex bg-[#0A0C10]">
      {/* Communications List */}
      <div
        className={`${
          selectedComm ? "w-1/2" : "w-full"
        } border-r border-white/5 bg-[#0D0F14]/40 overflow-auto transition-all duration-300 relative`}
      >
        <div className="px-12 py-10">
          <div className="flex items-center justify-between mb-8 pb-6 border-b border-white/5">
            <h3 className="text-2xl font-bold tracking-tight text-white flex items-center gap-3">
              Communications
              <span className="text-sm bg-[#8251EE]/20 text-[#8251EE] border border-[#8251EE]/30 px-3 py-1 rounded-full">{communications?.length || 0}</span>
            </h3>
            <button
              onClick={() => setShowCreate(true)}
              className="px-6 py-2.5 bg-[#8251EE] text-white font-bold rounded-xl hover:bg-[#9366F5] shadow-[0_0_20px_rgba(130,81,238,0.3)] transition-all active:scale-95"
            >
              + Log Activity
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
            <div className="space-y-4">
              {communications.map((comm) => (
                <button
                  key={comm.id}
                  onClick={() =>
                    setSelectedCommId(
                      selectedCommId === comm.id ? null : comm.id
                    )
                  }
                  className={cn(
                    "group relative w-full text-left backdrop-blur-md bg-[#12141A]/60 p-6 rounded-2xl border transition-all duration-300 shadow-[0_8px_20px_rgba(0,0,0,0.3)]",
                    selectedCommId === comm.id
                      ? "border-[#8251EE] bg-[#8251EE]/10 ring-1 ring-[#8251EE]/40"
                      : "border-white/5 hover:border-[#8251EE]/40 hover:bg-[#12141A]/80 hover:shadow-[0_10px_30px_rgba(130,81,238,0.1)]"
                  )}
                >
                  <div className="flex items-start gap-5">
                    <div className="mt-1 p-2 rounded-xl bg-white/5 group-hover:bg-[#8251EE]/20 transition-colors">
                        {getCommIcon(comm.comm_type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="text-[10px] font-bold text-[#A1A1AA] uppercase tracking-[0.2em] font-mono">
                          {getCommTypeLabel(comm.comm_type)}
                        </span>
                        {comm.is_vectorized && (
                          <span className="bg-[#10B981]/20 text-[#10B981] px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest border border-[#10B981]/30">
                            Indexed
                          </span>
                        )}
                      </div>
                      {comm.subject ? (
                        <p className="text-base font-bold text-white group-hover:text-[#8251EE] transition-colors">
                          {comm.subject}
                        </p>
                      ) : (
                        <p className="text-base font-bold text-white/40 italic">No subject</p>
                      )}
                      {comm.transcript_body && (
                        <p className="mt-2.5 text-sm text-[#A1A1AA] line-clamp-2 leading-relaxed">
                          {truncate(comm.transcript_body, 200)}
                        </p>
                      )}
                      <div className="mt-4 flex flex-wrap items-center gap-4 text-[10px] font-bold uppercase tracking-widest text-white/30 font-mono">
                        {comm.sender && (
                            <span className="flex items-center gap-1.5">
                                <span className="h-1 w-1 rounded-full bg-white/20" />
                                From: <span className="text-white/60">{comm.sender}</span>
                            </span>
                        )}
                        <span className="flex items-center gap-1.5">
                            <span className="h-1 w-1 rounded-full bg-white/20" />
                            {formatDateTime(comm.timestamp)}
                        </span>
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
