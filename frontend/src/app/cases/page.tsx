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
      <div className="px-8 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-heading">Cases</h1>
            <p className="mt-1 text-sm text-muted">
              Manage your legal cases and track progress.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setShowCreateClient(true)}
              className="btn-secondary"
            >
              + New Client
            </button>
            <button
              onClick={() => setShowCreateCase(true)}
              className="btn-primary"
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
            <div className="animate-spin h-8 w-8 rounded-full border-4 border-brand-600 border-t-transparent" />
          </div>
        ) : !cases || cases.length === 0 ? (
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
                d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
              />
            </svg>
            <h3 className="mt-4 text-lg font-medium text-heading">
              No cases yet
            </h3>
            <p className="mt-2 text-sm text-muted">
              Create a client first, then create your first case.
            </p>
          </div>
        ) : (
          <div className="grid gap-4">
            {cases.map((c) => {
              const statusColors = getStatusColor(c.status);
              return (
                <Link
                  key={c.id}
                  href={`/cases/${c.id}`}
                  className="card hover:shadow-md transition-shadow group"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-base font-semibold text-heading group-hover:text-brand-600 transition-colors">
                        {c.title}
                      </h3>
                      {c.description && (
                        <p className="mt-1 text-sm text-muted line-clamp-2">
                          {c.description}
                        </p>
                      )}
                      <div className="mt-3 flex items-center gap-4 text-xs text-faint">
                        <span>Created {formatDate(c.created_at)}</span>
                        {c.filing_date && (
                          <span>Filed {formatDate(c.filing_date)}</span>
                        )}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
                        statusColors.bg,
                        statusColors.text,
                        statusColors.ring
                      )}
                    >
                      {c.status.replaceAll("_", " ")}
                    </span>
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
