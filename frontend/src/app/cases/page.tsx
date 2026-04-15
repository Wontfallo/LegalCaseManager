"use client";

import { useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import AppShell from "@/components/layout/AppShell";
import { useCases, useCreateCase, useClients, useCreateClient } from "@/hooks/useApi";
import { formatDate, getStatusColor, cn } from "@/lib/utils";
import type { CaseCreate, ClientCreate } from "@/types";

export default function CasesPage() {
  const { data: cases, isLoading: casesLoading } = useCases();
  const { data: clients } = useClients();
  const createCase = useCreateCase();
  const createClient = useCreateClient();

  const [showCreateCase, setShowCreateCase] = useState(false);
  const [showCreateClient, setShowCreateClient] = useState(false);

  // Case form state
  const [newCase, setNewCase] = useState<CaseCreate>({
    client_id: "",
    title: "",
    description: "",
  });

  // Client form state
  const [newClient, setNewClient] = useState<ClientCreate>({
    name: "",
    contact_info: { email: "", phone: "" },
  });

  const handleCreateCase = async () => {
    if (!newCase.client_id || !newCase.title) {
      toast.error("Client and title are required.");
      return;
    }
    try {
      await createCase.mutateAsync(newCase);
      toast.success("Case created successfully.");
      setShowCreateCase(false);
      setNewCase({ client_id: "", title: "", description: "" });
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Failed to create case.");
    }
  };

  const handleCreateClient = async () => {
    if (!newClient.name) {
      toast.error("Client name is required.");
      return;
    }
    try {
      await createClient.mutateAsync(newClient);
      toast.success("Client created.");
      setShowCreateClient(false);
      setNewClient({ name: "", contact_info: { email: "", phone: "" } });
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Failed to create client.");
    }
  };

  return (
    <AppShell>
      <div className="px-12 py-10 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12 pb-8 border-b border-white/5">
          <div>
            <h1 className="text-4xl font-black text-white tracking-tight">Cases</h1>
            <p className="mt-2 text-base text-[#A1A1AA] font-medium">
              Manage your legal cases and track progress with AI-powered insights.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setShowCreateClient(true)}
              className="px-6 py-3 bg-white/5 border border-white/10 text-white font-bold rounded-xl hover:bg-white/10 transition-all active:scale-95"
            >
              + New Client
            </button>
            <button
              onClick={() => setShowCreateCase(true)}
              className="px-6 py-3 bg-[#8251EE] text-white font-bold rounded-xl hover:bg-[#9366F5] shadow-[0_0_20px_rgba(130,81,238,0.3)] transition-all active:scale-95"
            >
              + New Case
            </button>
          </div>
        </div>

        {/* Create Client Modal */}
        {showCreateClient && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="card w-full max-w-lg mx-4">
              <h2 className="text-lg font-semibold text-heading mb-4">
                Create New Client
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="block label-text mb-1">
                    Client Name
                  </label>
                  <input
                    type="text"
                    value={newClient.name}
                    onChange={(e) =>
                      setNewClient({ ...newClient, name: e.target.value })
                    }
                    className="input-field"
                    placeholder="e.g., John Smith"
                  />
                </div>
                <div>
                  <label className="block label-text mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    value={
                      (newClient.contact_info as Record<string, string>)?.email || ""
                    }
                    onChange={(e) =>
                      setNewClient({
                        ...newClient,
                        contact_info: {
                          ...(newClient.contact_info as Record<string, string>),
                          email: e.target.value,
                        },
                      })
                    }
                    className="input-field"
                    placeholder="john@example.com"
                  />
                </div>
                <div>
                  <label className="block label-text mb-1">
                    Phone
                  </label>
                  <input
                    type="tel"
                    value={
                      (newClient.contact_info as Record<string, string>)?.phone || ""
                    }
                    onChange={(e) =>
                      setNewClient({
                        ...newClient,
                        contact_info: {
                          ...(newClient.contact_info as Record<string, string>),
                          phone: e.target.value,
                        },
                      })
                    }
                    className="input-field"
                    placeholder="+1 (555) 123-4567"
                  />
                </div>
              </div>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  onClick={() => setShowCreateClient(false)}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateClient}
                  disabled={createClient.isPending}
                  className="btn-primary"
                >
                  {createClient.isPending ? "Creating..." : "Create Client"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Create Case Modal */}
        {showCreateCase && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="card w-full max-w-lg mx-4">
              <h2 className="text-lg font-semibold text-heading mb-4">
                Create New Case
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="block label-text mb-1">
                    Client
                  </label>
                  <select
                    value={newCase.client_id}
                    onChange={(e) =>
                      setNewCase({ ...newCase, client_id: e.target.value })
                    }
                    className="input-field"
                  >
                    <option value="">Select a client...</option>
                    {clients?.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block label-text mb-1">
                    Case Title
                  </label>
                  <input
                    type="text"
                    value={newCase.title}
                    onChange={(e) =>
                      setNewCase({ ...newCase, title: e.target.value })
                    }
                    className="input-field"
                    placeholder="e.g., Smith v. Jones – Contract Dispute"
                  />
                </div>
                <div>
                  <label className="block label-text mb-1">
                    Description
                  </label>
                  <textarea
                    value={newCase.description || ""}
                    onChange={(e) =>
                      setNewCase({ ...newCase, description: e.target.value })
                    }
                    className="input-field min-h-[100px]"
                    placeholder="Brief case description..."
                  />
                </div>
              </div>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  onClick={() => setShowCreateCase(false)}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateCase}
                  disabled={createCase.isPending}
                  className="btn-primary"
                >
                  {createCase.isPending ? "Creating..." : "Create Case"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Cases List */}
        {casesLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin h-8 w-8 rounded-full border-4 border-[#8251EE] border-t-transparent shadow-[0_0_15px_rgba(130,81,238,0.3)]" />
          </div>
        ) : !cases || cases.length === 0 ? (
          <div className="text-center py-20 backdrop-blur-md bg-[#12141A]/40 border border-white/5 rounded-2xl p-12">
            <svg
              className="mx-auto h-12 w-12 text-[#A1A1AA]"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
              />
            </svg>
            <h3 className="mt-4 text-xl font-bold text-white">
              No cases yet
            </h3>
            <p className="mt-2 text-[#A1A1AA] font-medium">
              Create a client first, then create your first case to get started.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {cases.map((c) => {
              const statusColors = getStatusColor(c.status);
              return (
                <Link
                  key={c.id}
                  href={`/cases/${c.id}`}
                  className="group relative flex flex-col backdrop-blur-md bg-[#12141A]/60 p-8 rounded-2xl border border-white/5 transition-all duration-300 hover:border-[#8251EE]/40 hover:bg-[#12141A]/80 hover:shadow-[0_10px_30px_rgba(0,0,0,0.5)] overflow-hidden"
                >
                  <div className="absolute top-0 right-0 w-24 h-24 bg-[#8251EE]/5 blur-2xl -mr-12 -mt-12 group-hover:bg-[#8251EE]/10 transition-all" />
                  <div className="flex-1 min-w-0 relative z-10">
                    <div className="flex items-start justify-between mb-4">
                        <span
                        className={cn(
                            "inline-flex items-center rounded-lg px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ring-1 ring-inset",
                            statusColors.bg,
                            statusColors.text,
                            statusColors.ring
                        )}
                        >
                        {c.status.replaceAll("_", " ")}
                        </span>
                    </div>
                    <h3 className="text-xl font-bold text-white group-hover:text-[#8251EE] transition-colors leading-tight mb-3">
                      {c.title}
                    </h3>
                    {c.description && (
                      <p className="text-sm text-[#A1A1AA] line-clamp-3 leading-relaxed mb-6 font-medium">
                        {c.description}
                      </p>
                    )}
                  </div>
                  <div className="mt-auto pt-6 border-t border-white/5 flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] font-mono relative z-10">
                    <span>Created {formatDate(c.created_at)}</span>
                    <svg className="h-4 w-4 transform group-hover:translate-x-1 transition-transform text-[#8251EE]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                    </svg>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
