"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import clsx from "clsx";

type Provider = {
  id: string;
  label: string;
  defaultBaseUrl: string | null;
  apiKey: "required" | "optional";
  exampleModel: string;
  hint: string;
};

type SavedSettings = {
  provider: string;
  model: string;
  baseUrl: string | null;
  contextWindow: number | null;
  hasApiKey: boolean;
  verifiedAt: string | null;
};

type Check = { id: string; label: string; status: "pass" | "warn" | "fail"; detail: string };

type Report = {
  verdict: "ready" | "limited" | "unsupported";
  model: string;
  contextWindow: number | null;
  latencyMs: number | null;
  checks: Check[];
};

type SettingsResponse = {
  settings: SavedSettings | null;
  defaultModel: { provider: string; model: string };
  providers: Provider[];
  requirements: { minimumContextWindow: number; recommendedContextWindow: number };
};

type Form = {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  contextWindow: string;
};

const inputClass =
  "bg-bg-base border border-bg-border rounded-lg px-3 py-2 text-xs font-mono text-text-primary placeholder:text-text-muted/60 focus:outline-none focus:border-accent-violet/50 transition-colors w-full";
const labelClass = "text-xs font-mono text-text-muted uppercase tracking-wider";

const VERDICT = {
  ready: { label: "Ready for reviews", className: "text-status-green border-status-green/30 bg-status-green/5" },
  limited: { label: "Usable, with caveats", className: "text-status-yellow border-status-yellow/30 bg-status-yellow/5" },
  unsupported: { label: "Cannot produce reviews", className: "text-status-red border-status-red/30 bg-status-red/5" },
} as const;

function formFor(settings: SavedSettings | null, providers: Provider[]): Form {
  const provider = settings?.provider ?? providers[0]?.id ?? "openrouter";
  return {
    provider,
    model: settings?.model ?? "",
    baseUrl: settings?.baseUrl ?? "",
    apiKey: "",
    contextWindow: settings?.contextWindow ? String(settings.contextWindow) : "",
  };
}

function CheckIcon({ status }: { status: Check["status"] }) {
  if (status === "pass") return <CheckCircle2 size={14} className="text-status-green shrink-0 mt-px" />;
  if (status === "warn") return <AlertTriangle size={14} className="text-status-yellow shrink-0 mt-px" />;
  return <XCircle size={14} className="text-status-red shrink-0 mt-px" />;
}

export default function ModelSettings() {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [useOwnModel, setUseOwnModel] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState<"test" | "save" | "reset" | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/settings/model", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Failed to load model settings");
        const loaded = payload as SettingsResponse;
        setData(loaded);
        setUseOwnModel(Boolean(loaded.settings));
        setForm(formFor(loaded.settings, loaded.providers));
      })
      .catch((error) => {
        if (!controller.signal.aborted) setLoadError(error.message);
      });
    return () => controller.abort();
  }, []);

  if (loadError) {
    return (
      <div className="bg-bg-panel border border-bg-border rounded-xl p-5 space-y-2">
        <h2 className="text-sm font-semibold text-text-primary">Review model</h2>
        <p className="text-xs text-status-red font-mono">{loadError}</p>
      </div>
    );
  }

  if (!data || !form) {
    return (
      <div className="bg-bg-panel border border-bg-border rounded-xl p-5 flex items-center gap-2 text-xs font-mono text-text-muted">
        <Loader2 size={12} className="animate-spin" /> Loading model settings…
      </div>
    );
  }

  const saved = data.settings;
  const provider = data.providers.find((p) => p.id === form.provider) ?? data.providers[0]!;
  const savedKeyApplies = Boolean(saved?.hasApiKey && saved.provider === form.provider);
  const update = (patch: Partial<Form>) => {
    setForm({ ...form, ...patch });
    setReport(null);
    setMessage(null);
  };

  const payload = () =>
    JSON.stringify({
      provider: form.provider,
      model: form.model.trim(),
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey.trim(),
      contextWindow: form.contextWindow.trim() ? Number(form.contextWindow) : null,
    });

  async function send(kind: "test" | "save") {
    setBusy(kind);
    setReport(null);
    setMessage(null);
    try {
      const response = await fetch(
        kind === "test" ? "/api/settings/model/check" : "/api/settings/model",
        { method: kind === "test" ? "POST" : "PUT", body: payload(), headers: { "Content-Type": "application/json" } },
      );
      const body = await response.json().catch(() => ({}));
      if (body.report) setReport(body.report);
      if (!response.ok) {
        setMessage({ tone: "error", text: body.error ?? "Request failed" });
        return;
      }
      if (kind === "save") {
        setData({ ...data!, settings: body.settings });
        setForm((current) => current && { ...current, apiKey: "" });
        setMessage({ tone: "ok", text: "Saved. New reviews will use this model." });
      }
    } catch {
      setMessage({ tone: "error", text: "Unable to reach the server" });
    } finally {
      setBusy(null);
    }
  }

  async function resetToDefault() {
    setBusy("reset");
    setMessage(null);
    setReport(null);
    try {
      const response = await fetch("/api/settings/model", { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage({ tone: "error", text: body.error ?? "Reset failed" });
        return;
      }
      setData({ ...data!, settings: null });
      setForm(formFor(null, data!.providers));
      setUseOwnModel(false);
      setMessage({ tone: "ok", text: "Reviews use Lorica's default model again." });
    } catch {
      setMessage({ tone: "error", text: "Unable to reach the server" });
    } finally {
      setBusy(null);
    }
  }

  const canSubmit =
    form.model.trim() !== "" &&
    (provider.apiKey === "optional" || form.apiKey.trim() !== "" || savedKeyApplies) &&
    (provider.defaultBaseUrl !== null || form.baseUrl.trim() !== "") &&
    busy === null;
  const tokensK = (n: number) => `${Math.round(n / 1000)}K`;

  return (
    <div className="bg-bg-panel border border-bg-border rounded-xl p-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-text-primary">Review model</h2>
        <p className="text-xs text-text-muted mt-0.5">
          Optional. Lorica reviews with its built-in model unless you bring your own.
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-lg border border-bg-border bg-bg-base px-3 py-2">
        <div className="min-w-0">
          <p className={labelClass}>Active</p>
          <p className="text-xs font-mono text-text-primary truncate">
            {saved
              ? `${data.providers.find((p) => p.id === saved.provider)?.label ?? saved.provider} · ${saved.model}`
              : `Lorica default · ${data.defaultModel.model}`}
          </p>
        </div>
        {saved && (
          <button
            onClick={resetToDefault}
            disabled={busy !== null}
            className="shrink-0 px-3 py-1.5 text-xs font-mono text-text-secondary border border-bg-border rounded-lg hover:bg-bg-hover transition-colors disabled:opacity-50"
          >
            {busy === "reset" ? "Resetting…" : "Reset to default"}
          </button>
        )}
      </div>

      <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer w-fit">
        <input
          type="checkbox"
          checked={useOwnModel}
          onChange={(event) => {
            setUseOwnModel(event.target.checked);
            setReport(null);
            setMessage(null);
          }}
          className="accent-accent-violet"
        />
        Use my own model and API key
      </label>

      {!useOwnModel && saved && (
        <p className="text-xs text-text-muted">
          Your custom model stays active until you reset to the default.
        </p>
      )}

      {useOwnModel && (
        <div className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <label className={labelClass} htmlFor="llm-provider">Provider</label>
            <select
              id="llm-provider"
              value={form.provider}
              onChange={(event) => update({ provider: event.target.value, model: "", baseUrl: "", apiKey: "" })}
              className={clsx(inputClass, "appearance-none sm:w-fit")}
            >
              {data.providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-text-muted">{provider.hint}</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={labelClass} htmlFor="llm-model">Model</label>
            <input
              id="llm-model"
              value={form.model}
              onChange={(event) => update({ model: event.target.value })}
              placeholder={provider.exampleModel}
              className={inputClass}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={labelClass} htmlFor="llm-base-url">
              Base URL {provider.defaultBaseUrl && <span className="normal-case">(optional)</span>}
            </label>
            <input
              id="llm-base-url"
              value={form.baseUrl}
              onChange={(event) => update({ baseUrl: event.target.value })}
              placeholder={provider.defaultBaseUrl ?? "http://localhost:8080/v1"}
              className={inputClass}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={labelClass} htmlFor="llm-api-key">
              API key {provider.apiKey === "optional" && <span className="normal-case">(optional)</span>}
            </label>
            <input
              id="llm-api-key"
              type="password"
              value={form.apiKey}
              onChange={(event) => update({ apiKey: event.target.value })}
              placeholder={savedKeyApplies ? "Saved key in use. Type to replace it" : ""}
              className={inputClass}
              autoComplete="off"
            />
            <p className="text-xs text-text-muted">
              Stored encrypted and never shown again.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={labelClass} htmlFor="llm-context">
              Context window <span className="normal-case">(tokens, optional)</span>
            </label>
            <input
              id="llm-context"
              inputMode="numeric"
              value={form.contextWindow}
              onChange={(event) => update({ contextWindow: event.target.value.replace(/[^0-9]/g, "") })}
              placeholder="Detected automatically when the provider reports it"
              className={clsx(inputClass, "sm:w-80")}
            />
            <p className="text-xs text-text-muted">
              Reviews need at least {tokensK(data.requirements.minimumContextWindow)} tokens;{" "}
              {tokensK(data.requirements.recommendedContextWindow)}+ avoids smaller chunks.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => send("test")}
              disabled={!canSubmit}
              className="px-4 py-2 text-xs font-mono text-text-primary border border-bg-border rounded-lg hover:bg-bg-hover transition-colors disabled:opacity-50"
            >
              {busy === "test" ? "Testing…" : "Test model"}
            </button>
            <button
              onClick={() => send("save")}
              disabled={!canSubmit}
              className="px-4 py-2 bg-accent-violet text-white text-xs font-mono rounded-lg hover:bg-accent-violet-dim transition-colors disabled:opacity-50"
            >
              {busy === "save" ? "Testing and saving…" : "Save model"}
            </button>
            {(busy === "test" || busy === "save") && (
              <span className="flex items-center gap-1.5 text-xs font-mono text-text-muted">
                <Loader2 size={12} className="animate-spin" />
                Running a test review. Local models can take a minute.
              </span>
            )}
          </div>
        </div>
      )}

      {message && (
        <p className={clsx("text-xs font-mono", message.tone === "ok" ? "text-status-green" : "text-status-red")}>
          {message.text}
        </p>
      )}

      {report && (
        <div className="rounded-lg border border-bg-border bg-bg-base p-3 space-y-3">
          <span
            className={clsx(
              "inline-block px-2 py-0.5 text-xs font-mono border rounded-md",
              VERDICT[report.verdict].className,
            )}
          >
            {VERDICT[report.verdict].label}
          </span>
          <ul className="space-y-2">
            {report.checks.map((check) => (
              <li key={check.id} className="flex items-start gap-2">
                <CheckIcon status={check.status} />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-text-primary">{check.label}</p>
                  <p className="text-xs text-text-secondary break-words">{check.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
