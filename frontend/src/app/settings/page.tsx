"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import AppShell from "@/components/layout/AppShell";
import { apiClient } from "@/lib/api";

// ── Types ────────────────────────────────────────────────

interface ProviderInfo {
  enabled: boolean;
  chat_model?: string;
  embedding_model?: string;
  has_api_key?: boolean;
  source?: string;
}

interface ProviderSummary {
  [key: string]: ProviderInfo | string | null;
  _active_chat: string | null;
  _active_embedding: string | null;
}

interface DeviceFlowState {
  user_code: string;
  verification_uri: string;
  expires_in: number;
}

interface PollResult {
  status: "pending" | "complete" | "error";
  message: string;
  interval?: number;
}

// Fallback models if API fetch fails
const FALLBACK_CHAT_MODELS = [
  "gpt-4o",
  "gpt-4.1",
  "gpt-4.1-mini",
  "o1",
  "o3-mini",
  "claude-sonnet-4",
  "claude-3.5-sonnet",
];

const FALLBACK_EMBEDDING_MODELS = ["text-embedding-3-small", "text-embedding-3-large"];

// ── Provider Metadata ────────────────────────────────────

const PROVIDER_META: Record<
  string,
  { label: string; description: string; icon: string; needsKey: boolean }
> = {
  github_copilot: {
    label: "GitHub Copilot",
    description: "Use your existing Copilot subscription. Connects via OAuth device flow.",
    icon: "GH",
    needsKey: false,
  },
  google_gemini: {
    label: "Google Gemini",
    description: "Google AI Studio. Free tier available. Get key at aistudio.google.com/apikey",
    icon: "Gm",
    needsKey: true,
  },
  lm_studio: {
    label: "LM Studio",
    description: "Local models via LM Studio. Download at lmstudio.ai. No API key needed.",
    icon: "LM",
    needsKey: false,
  },
  ollama: {
    label: "Ollama",
    description: "Local models via Ollama. Download at ollama.com. No API key needed.",
    icon: "OL",
    needsKey: false,
  },
  openai: {
    label: "OpenAI",
    description: "Configured via OPENAI_API_KEY in .env file.",
    icon: "OA",
    needsKey: true,
  },
  mistral: {
    label: "Mistral",
    description: "Configured via MISTRAL_API_KEY in .env file.",
    icon: "MI",
    needsKey: true,
  },
};

// ── Main Component ───────────────────────────────────────

export default function SettingsPage() {
  const [providers, setProviders] = useState<ProviderSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configuring, setConfiguring] = useState<string | null>(null);

  // GitHub Device Flow state
  const [deviceFlow, setDeviceFlow] = useState<DeviceFlowState | null>(null);
  const [deviceFlowPolling, setDeviceFlowPolling] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copilotChatModel, setCopilotChatModel] = useState("gpt-4o");
  const [copilotEmbeddingModel, setCopilotEmbeddingModel] = useState(
    "text-embedding-3-small"
  );

  // Dynamic model lists from Copilot API
  const [copilotChatModels, setCopilotChatModels] = useState<string[]>(FALLBACK_CHAT_MODELS);
  const [copilotEmbeddingModels, setCopilotEmbeddingModels] = useState<string[]>(FALLBACK_EMBEDDING_MODELS);

  // Gemini API key input
  const [geminiKey, setGeminiKey] = useState("");
  const [geminiModel, setGeminiModel] = useState("gemini-2.0-flash");

  const fetchProviders = useCallback(async () => {
    try {
      const data = await apiClient.get<ProviderSummary>("/api/providers");
      setProviders(data);
      const copilot = data.github_copilot as ProviderInfo | undefined;
      if (copilot?.chat_model) {
        setCopilotChatModel(copilot.chat_model);
      }
      if (copilot?.embedding_model) {
        setCopilotEmbeddingModel(copilot.embedding_model);
      }
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Failed to load providers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  // Fetch available Copilot models when provider is connected
  const fetchCopilotModels = useCallback(async () => {
    try {
      const data = await apiClient.get<{ models: { id: string; name: string; type: string }[] }>(
        "/api/providers/github-copilot/models"
      );
      const chat: string[] = [];
      const embed: string[] = [];
      for (const m of data.models) {
        if (m.type === "embeddings") {
          embed.push(m.id);
        } else {
          chat.push(m.id);
        }
      }
      if (chat.length > 0) setCopilotChatModels(chat);
      if (embed.length > 0) setCopilotEmbeddingModels(embed);
    } catch {
      // Keep fallback lists
    }
  }, []);

  useEffect(() => {
    const copilot = providers?.github_copilot as ProviderInfo | undefined;
    if (copilot?.enabled) {
      fetchCopilotModels();
    }
  }, [providers, fetchCopilotModels]);

  // Cleanup poll timer on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  // ── GitHub Copilot Device Flow ─────────────────────────

  const startCopilotConnect = async () => {
    setConfiguring("github_copilot");
    setDeviceFlow(null);
    try {
      const result = await apiClient.post<DeviceFlowState>(
        "/api/providers/github-copilot/connect"
      );
      setDeviceFlow(result);
      // Start polling
      setDeviceFlowPolling(true);
      pollCopilotAuth(5);
    } catch (err: any) {
      setError(err?.message || "Failed to start GitHub device flow");
      setConfiguring(null);
    }
  };

  const pollCopilotAuth = async (interval: number) => {
    try {
      const result = await apiClient.get<PollResult>(
        "/api/providers/github-copilot/poll"
      );

      if (result.status === "complete") {
        setDeviceFlowPolling(false);
        setDeviceFlow(null);
        setConfiguring(null);
        fetchProviders();
        return;
      }

      if (result.status === "error") {
        setDeviceFlowPolling(false);
        setError(result.message);
        setConfiguring(null);
        return;
      }

      // Still pending — poll again
      const nextInterval = (result.interval || interval) * 1000;
      pollTimerRef.current = setTimeout(
        () => pollCopilotAuth(result.interval || interval),
        nextInterval
      );
    } catch (err: any) {
      setDeviceFlowPolling(false);
      setError(err?.message || "Polling failed");
      setConfiguring(null);
    }
  };

  // ── Gemini Configure ──────────────────────────────────

  const configureGemini = async () => {
    if (!geminiKey.trim()) return;
    setConfiguring("google_gemini");
    try {
      await apiClient.post("/api/providers/configure", {
        provider: "google_gemini",
        enabled: true,
        api_key: geminiKey.trim(),
        chat_model: geminiModel,
        embedding_model: "text-embedding-004",
      });
      setGeminiKey("");
      setConfiguring(null);
      fetchProviders();
    } catch (err: any) {
      setError(err?.message || "Failed to configure Gemini");
      setConfiguring(null);
    }
  };

  // ── Local Provider Auto-Detect ────────────────────────

  const autoDetectLocal = async () => {
    setConfiguring("local");
    try {
      const result = await apiClient.post<Record<string, any>>(
        "/api/providers/local/auto-detect"
      );

      const messages: string[] = [];
      if (result.lm_studio?.detected) {
        messages.push(
          `LM Studio detected with ${result.lm_studio.models?.length || 0} models`
        );
      }
      if (result.ollama?.detected) {
        messages.push(
          `Ollama detected with ${result.ollama.models?.length || 0} models`
        );
      }
      if (messages.length === 0) {
        messages.push("No local providers detected. Make sure LM Studio or Ollama is running.");
      }
      alert(messages.join("\n"));
      fetchProviders();
    } catch (err: any) {
      setError(err?.message || "Auto-detect failed");
    } finally {
      setConfiguring(null);
    }
  };

  // ── Disable Provider ──────────────────────────────────

  const disableProvider = async (providerKey: string) => {
    try {
      await apiClient.post("/api/providers/configure", {
        provider: providerKey,
        enabled: false,
      });
      fetchProviders();
    } catch (err: any) {
      setError(err?.message || "Failed to disable provider");
    }
  };

  const saveCopilotModels = async () => {
    setConfiguring("github_copilot_model");
    try {
      await apiClient.post("/api/providers/configure", {
        provider: "github_copilot",
        enabled: true,
        chat_model: copilotChatModel,
        embedding_model: copilotEmbeddingModel,
      });
      await fetchProviders();
    } catch (err: any) {
      setError(err?.message || "Failed to save GitHub Copilot model settings");
    } finally {
      setConfiguring(null);
    }
  };

  // ── Render ────────────────────────────────────────────

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-full">
          <div className="animate-spin h-8 w-8 rounded-full border-4 border-brand-600 border-t-transparent" />
        </div>
      </AppShell>
    );
  }

  const activeChat = providers?._active_chat as string | null;
  const activeEmbed = providers?._active_embedding as string | null;

  return (
    <AppShell>
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">
          AI Provider Settings
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
          Configure LLM providers for timeline extraction, semantic search, and
          document analysis. The app works offline without any provider, but AI
          features require at least one.
        </p>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:border-red-900 dark:text-red-300">
            {error}
            <button
              onClick={() => setError(null)}
              className="ml-2 text-red-500 hover:text-red-700 font-medium"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Active Provider Summary */}
        <div className="mb-6 grid grid-cols-2 gap-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">
              Active Chat Provider
            </div>
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {activeChat
                ? PROVIDER_META[activeChat]?.label || activeChat
                : "None"}
            </div>
            {activeChat && (
              <div className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                Model:{" "}
                {(providers?.[activeChat] as ProviderInfo)?.chat_model || "—"}
              </div>
            )}
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">
              Active Embedding Provider
            </div>
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {activeEmbed
                ? PROVIDER_META[activeEmbed]?.label || activeEmbed
                : "None (using pseudo-embeddings)"}
            </div>
            {activeEmbed && (
              <div className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                Model:{" "}
                {(providers?.[activeEmbed] as ProviderInfo)?.embedding_model ||
                  "—"}
              </div>
            )}
          </div>
        </div>

        {/* Provider Cards */}
        <div className="space-y-4">
          {/* GitHub Copilot */}
          <ProviderCard
            providerKey="github_copilot"
            info={providers?.github_copilot as ProviderInfo}
            isActive={activeChat === "github_copilot"}
          >
            {(providers?.github_copilot as ProviderInfo)?.enabled ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
                    Connected
                  </span>
                  <button
                    onClick={() => disableProvider("github_copilot")}
                    className="text-xs text-red-600 hover:text-red-800"
                  >
                    Disconnect
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Chat Model
                    </label>
                    <select
                      aria-label="GitHub Copilot chat model"
                      value={copilotChatModel}
                      onChange={(e) => setCopilotChatModel(e.target.value)}
                      className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-brand-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    >
                      {copilotChatModels.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Embedding Model
                    </label>
                    <select
                      aria-label="GitHub Copilot embedding model"
                      value={copilotEmbeddingModel}
                      onChange={(e) => setCopilotEmbeddingModel(e.target.value)}
                      className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-brand-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    >
                      {copilotEmbeddingModels.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    onClick={saveCopilotModels}
                    disabled={configuring === "github_copilot_model"}
                    className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 transition-colors"
                  >
                    {configuring === "github_copilot_model" ? "Saving..." : "Save Models"}
                  </button>
                </div>
              </div>
            ) : deviceFlow ? (
              <div className="space-y-3">
                <p className="text-sm text-slate-700">
                  Go to{" "}
                  <a
                    href={deviceFlow.verification_uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-600 underline font-medium"
                  >
                    {deviceFlow.verification_uri}
                  </a>
                </p>
                <div className="flex items-center gap-3">
                  <code className="rounded bg-slate-100 px-4 py-2 text-2xl font-mono font-bold tracking-widest text-slate-900">
                    {deviceFlow.user_code}
                  </code>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(deviceFlow.user_code);
                    }}
                    className="text-xs text-slate-500 hover:text-slate-700"
                  >
                    Copy
                  </button>
                </div>
                {deviceFlowPolling && (
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <div className="animate-spin h-3 w-3 rounded-full border-2 border-brand-600 border-t-transparent" />
                    Waiting for authorization...
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={startCopilotConnect}
                disabled={configuring === "github_copilot"}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 transition-colors"
              >
                {configuring === "github_copilot"
                  ? "Connecting..."
                  : "Connect with GitHub"}
              </button>
            )}
          </ProviderCard>

          {/* Google Gemini */}
          <ProviderCard
            providerKey="google_gemini"
            info={providers?.google_gemini as ProviderInfo}
            isActive={
              activeChat === "google_gemini" ||
              activeEmbed === "google_gemini"
            }
          >
            {(providers?.google_gemini as ProviderInfo)?.enabled ? (
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
                  Configured
                </span>
                <button
                  onClick={() => disableProvider("google_gemini")}
                  className="text-xs text-red-600 hover:text-red-800"
                >
                  Remove
                </button>
              </div>
            ) : (
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    API Key
                  </label>
                  <input
                    type="password"
                    value={geminiKey}
                    onChange={(e) => setGeminiKey(e.target.value)}
                    placeholder="AIza..."
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Model
                  </label>
                  <select
                    aria-label="Google Gemini model"
                    value={geminiModel}
                    onChange={(e) => setGeminiModel(e.target.value)}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-brand-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                    <option value="gemini-2.5-pro-preview-06-05">Gemini 2.5 Pro</option>
                    <option value="gemini-2.5-flash-preview-05-20">Gemini 2.5 Flash</option>
                    <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
                  </select>
                </div>
                <button
                  onClick={configureGemini}
                  disabled={
                    !geminiKey.trim() || configuring === "google_gemini"
                  }
                  className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  Save
                </button>
              </div>
            )}
          </ProviderCard>

          {/* Local Providers */}
          <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-950">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Local Providers
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  LM Studio and Ollama run models locally on your machine. No
                  API key or internet needed.
                </p>
              </div>
              <button
                onClick={autoDetectLocal}
                disabled={configuring === "local"}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                {configuring === "local" ? "Scanning..." : "Auto-Detect"}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* LM Studio */}
              <div className="rounded-md border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
                <div className="mb-1 flex items-center gap-2">
                  <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    LM
                  </span>
                  <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                    LM Studio
                  </span>
                  {(providers?.lm_studio as ProviderInfo)?.enabled && (
                    <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                      Active
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {(providers?.lm_studio as ProviderInfo)?.enabled
                    ? `Model: ${(providers?.lm_studio as ProviderInfo)?.chat_model || "—"}`
                    : "Not detected. Start LM Studio and click Auto-Detect."}
                </p>
                {(providers?.lm_studio as ProviderInfo)?.enabled && (
                  <button
                    onClick={() => disableProvider("lm_studio")}
                    className="text-xs text-red-600 hover:text-red-800 mt-1"
                  >
                    Disable
                  </button>
                )}
              </div>

              {/* Ollama */}
              <div className="rounded-md border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
                <div className="mb-1 flex items-center gap-2">
                  <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    OL
                  </span>
                  <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                    Ollama
                  </span>
                  {(providers?.ollama as ProviderInfo)?.enabled && (
                    <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                      Active
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {(providers?.ollama as ProviderInfo)?.enabled
                    ? `Model: ${(providers?.ollama as ProviderInfo)?.chat_model || "—"}`
                    : "Not detected. Start Ollama and click Auto-Detect."}
                </p>
                {(providers?.ollama as ProviderInfo)?.enabled && (
                  <button
                    onClick={() => disableProvider("ollama")}
                    className="text-xs text-red-600 hover:text-red-800 mt-1"
                  >
                    Disable
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* .env providers (read-only display) */}
          {((providers?.openai as ProviderInfo)?.enabled ||
            (providers?.mistral as ProviderInfo)?.enabled) && (
            <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-950">
              <h3 className="mb-2 text-base font-semibold text-slate-900 dark:text-slate-100">
                Environment Variables
              </h3>
              <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
                These providers are configured in the backend .env file.
              </p>
              <div className="space-y-2">
                {(providers?.openai as ProviderInfo)?.enabled && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                      OpenAI
                    </span>
                    <span className="text-slate-600 dark:text-slate-300">
                      Model: {(providers?.openai as ProviderInfo)?.chat_model}
                    </span>
                  </div>
                )}
                {(providers?.mistral as ProviderInfo)?.enabled && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                      Mistral
                    </span>
                    <span className="text-slate-600 dark:text-slate-300">
                      Model:{" "}
                      {(providers?.mistral as ProviderInfo)?.chat_model}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

// ── ProviderCard Component ──────────────────────────────

function ProviderCard({
  providerKey,
  info,
  isActive,
  children,
}: {
  providerKey: string;
  info?: ProviderInfo;
  isActive: boolean;
  children: React.ReactNode;
}) {
  const meta = PROVIDER_META[providerKey];
  if (!meta) return null;

  return (
    <div
      className={`rounded-lg border bg-white p-5 transition-colors dark:bg-slate-950 ${
        isActive
          ? "border-brand-300 ring-1 ring-brand-100 dark:ring-brand-900/40"
          : "border-slate-200 dark:border-slate-800"
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <span
            className={`text-xs font-bold rounded px-2 py-1 ${
              info?.enabled
                ? "bg-brand-100 text-brand-700"
                : "bg-slate-200 text-slate-600"
            }`}
          >
            {meta.icon}
          </span>
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {meta.label}
              {isActive && (
                <span className="ml-2 text-xs font-normal text-brand-600">
                  (active)
                </span>
              )}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">{meta.description}</p>
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}
