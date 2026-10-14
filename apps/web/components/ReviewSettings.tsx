"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import { Coffee, Loader2, Megaphone, Plus, Trash2, VolumeX } from "lucide-react";
import clsx from "clsx";

type Profile = "quiet" | "chill" | "assertive";
type Severity = "critical" | "high" | "medium" | "low";

type Settings = {
  profile?: Profile;
  guidelines?: string;
  pathInstructions?: { path: string; instructions: string }[];
  excludePaths?: string[];
  tone?: string;
  workflow?: {
    autoReview?: boolean;
    reviewDrafts?: boolean;
    reviewOnPush?: boolean;
    baseBranches?: string[];
    ignoreTitleKeywords?: string[];
    ignoreAuthors?: string[];
  };
  style?: { minSeverity?: Severity; maxFindings?: number; fixPrompt?: boolean };
};

type Preset = { label: string; description: string; minSeverity: Severity; maxFindings: number };

type SettingsResponse = {
  settings: Settings | null;
  yaml: string;
  updatedBy: string | null;
  updatedAt: string | null;
  profiles: Record<Profile, Preset>;
  defaultProfile: Profile;
  repoConfigFiles: string[];
};

type Account = { login: string; type: "user" | "organization"; avatarUrl: string | null };

type Form = {
  profile: Profile;
  guidelines: string;
  tone: string;
  pathInstructions: { path: string; instructions: string }[];
  excludePaths: string;
  autoReview: boolean;
  reviewDrafts: boolean;
  reviewOnPush: boolean;
  baseBranches: string;
  ignoreTitleKeywords: string;
  ignoreAuthors: string;
  minSeverity: Severity | "";
  maxFindings: string;
  fixPrompt: boolean;
};

const inputClass =
  "bg-bg-base border border-bg-border rounded-lg px-3 py-2 text-xs font-mono text-text-primary placeholder:text-text-muted/60 focus:outline-none focus:border-accent-violet/50 transition-colors w-full";
const labelClass = "text-xs font-mono text-text-muted uppercase tracking-wider";
const hintClass = "text-xs text-text-muted";

const PROFILE_ICONS = { quiet: VolumeX, chill: Coffee, assertive: Megaphone } as const;
const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];

/** Splits a comma- or newline-separated field into its entries. */
function entries(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function formFor(settings: Settings | null, defaultProfile: Profile): Form {
  const workflow = settings?.workflow ?? {};
  const style = settings?.style ?? {};
  return {
    profile: settings?.profile ?? defaultProfile,
    guidelines: settings?.guidelines ?? "",
    tone: settings?.tone ?? "",
    pathInstructions: settings?.pathInstructions ?? [],
    excludePaths: (settings?.excludePaths ?? []).join("\n"),
    autoReview: workflow.autoReview ?? true,
    reviewDrafts: workflow.reviewDrafts ?? true,
    reviewOnPush: workflow.reviewOnPush ?? true,
    baseBranches: (workflow.baseBranches ?? []).join(", "),
    ignoreTitleKeywords: (workflow.ignoreTitleKeywords ?? []).join(", "),
    ignoreAuthors: (workflow.ignoreAuthors ?? []).join(", "),
    minSeverity: style.minSeverity ?? "",
    maxFindings: style.maxFindings ? String(style.maxFindings) : "",
    fixPrompt: style.fixPrompt ?? true,
  };
}

/** The form as a settings layer, leaving out everything left empty. */
function settingsFor(form: Form): Settings {
  const settings: Settings = {
    profile: form.profile,
    workflow: {
      autoReview: form.autoReview,
      reviewDrafts: form.reviewDrafts,
      reviewOnPush: form.reviewOnPush,
    },
    style: { fixPrompt: form.fixPrompt },
  };
  if (form.guidelines.trim()) settings.guidelines = form.guidelines.trim();
  if (form.tone.trim()) settings.tone = form.tone.trim();
  const pathInstructions = form.pathInstructions
    .map(({ path, instructions }) => ({ path: path.trim(), instructions: instructions.trim() }))
    .filter(({ path, instructions }) => path && instructions);
  if (pathInstructions.length) settings.pathInstructions = pathInstructions;
  if (entries(form.excludePaths).length) settings.excludePaths = entries(form.excludePaths);
  for (const key of ["baseBranches", "ignoreTitleKeywords", "ignoreAuthors"] as const) {
    if (entries(form[key]).length) settings.workflow![key] = entries(form[key]);
  }
  if (form.minSeverity) settings.style!.minSeverity = form.minSeverity;
  if (form.maxFindings) settings.style!.maxFindings = Number(form.maxFindings);
  return settings;
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex items-start gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="accent-accent-violet mt-0.5"
      />
      <span>
        <span className="block text-xs text-text-primary">{label}</span>
        <span className={hintClass}>{hint}</span>
      </span>
    </label>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 border-t border-bg-border pt-4">
      <div>
        <h3 className="text-xs font-semibold text-text-primary">{title}</h3>
        {hint && <p className={clsx(hintClass, "mt-0.5")}>{hint}</p>}
      </div>
      {children}
    </div>
  );
}

export default function ReviewSettings() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "reset" | null>(null);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/settings/accounts", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Failed to load accounts");
        setAccounts(payload.accounts);
        setAccount(payload.accounts[0]?.login ?? null);
      })
      .catch((error) => setLoadError(error.message));
  }, []);

  useEffect(() => {
    if (!account) return;
    const controller = new AbortController();
    setData(null);
    setForm(null);
    setMessage(null);
    setDirty(false);
    fetch(`/api/settings/review?account=${encodeURIComponent(account)}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Failed to load review settings");
        setData(payload);
        setForm(formFor(payload.settings, payload.defaultProfile));
      })
      .catch((error) => {
        if (!controller.signal.aborted) setLoadError(error.message);
      });
    return () => controller.abort();
  }, [account]);

  if (loadError) {
    return (
      <div className="bg-bg-panel border border-bg-border rounded-xl p-5 space-y-2">
        <h2 className="text-sm font-semibold text-text-primary">Review settings</h2>
        <p className="text-xs text-status-red font-mono">{loadError}</p>
      </div>
    );
  }

  if (!accounts || !data || !form) {
    return (
      <div className="bg-bg-panel border border-bg-border rounded-xl p-5 flex items-center gap-2 text-xs font-mono text-text-muted">
        <Loader2 size={12} className="animate-spin" /> Loading review settings…
      </div>
    );
  }

  const preset = data.profiles[form.profile];
  const selected = accounts.find((a) => a.login === account);
  const update = (patch: Partial<Form>) => {
    setForm({ ...form, ...patch });
    setDirty(true);
    setMessage(null);
  };
  const updatePath = (index: number, patch: Partial<Form["pathInstructions"][number]>) =>
    update({
      pathInstructions: form.pathInstructions.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)),
    });

  async function save() {
    setBusy("save");
    setMessage(null);
    try {
      const response = await fetch(`/api/settings/review?account=${encodeURIComponent(account!)}`, {
        method: "PUT",
        body: JSON.stringify(settingsFor(form!)),
        headers: { "Content-Type": "application/json" },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage({ tone: "error", text: body.error ?? "Save failed" });
        return;
      }
      setData({ ...data!, ...body });
      setForm(formFor(body.settings, data!.defaultProfile));
      setDirty(false);
      setMessage({ tone: "ok", text: "Saved. The next review uses these settings." });
    } catch {
      setMessage({ tone: "error", text: "Unable to reach the server" });
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    setBusy("reset");
    setMessage(null);
    try {
      const response = await fetch(`/api/settings/review?account=${encodeURIComponent(account!)}`, {
        method: "DELETE",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage({ tone: "error", text: body.error ?? "Reset failed" });
        return;
      }
      setData({ ...data!, ...body });
      setForm(formFor(null, data!.defaultProfile));
      setDirty(false);
      setMessage({ tone: "ok", text: "Reset to the defaults." });
    } catch {
      setMessage({ tone: "error", text: "Unable to reach the server" });
    } finally {
      setBusy(null);
    }
  }

  const maxFindingsValid =
    form.maxFindings === "" || (Number(form.maxFindings) >= 1 && Number(form.maxFindings) <= 100);

  return (
    <div className="bg-bg-panel border border-bg-border rounded-xl p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Review settings</h2>
          <p className={clsx(hintClass, "mt-0.5")}>
            Apply to every repository of the selected account. A{" "}
            <code className="font-mono">{data.repoConfigFiles[0]}</code> on a repository&apos;s base branch adds to
            them.
          </p>
        </div>
        {accounts.length > 1 && (
          <div className="flex items-center gap-2">
            {selected?.avatarUrl && (
              <Image src={selected.avatarUrl} alt="" width={20} height={20} className="rounded-full" />
            )}
            <select
              aria-label="Account"
              value={account ?? ""}
              onChange={(event) => setAccount(event.target.value)}
              className={clsx(inputClass, "appearance-none w-fit")}
            >
              {accounts.map((a) => (
                <option key={a.login} value={a.login}>
                  {a.login}
                  {a.type === "organization" ? " (organization)" : ""}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {data.updatedBy && data.updatedAt && (
        <p className={hintClass}>
          Last saved by @{data.updatedBy} on {new Date(data.updatedAt).toLocaleString()}
        </p>
      )}

      {/* Profile */}
      <div className="space-y-2">
        <p className={labelClass}>Profile</p>
        <div role="radiogroup" className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(data.profiles) as Profile[]).map((id) => {
            const Icon = PROFILE_ICONS[id];
            const active = form.profile === id;
            return (
              <button
                key={id}
                role="radio"
                aria-checked={active}
                onClick={() => update({ profile: id })}
                className={clsx(
                  "text-left rounded-lg border p-3 space-y-1 transition-colors",
                  active
                    ? "border-accent-violet/60 bg-accent-violet/10"
                    : "border-bg-border bg-bg-base hover:bg-bg-hover",
                )}
              >
                <span className="flex items-center gap-1.5 text-xs font-semibold text-text-primary">
                  <Icon size={13} className={active ? "text-accent-violet" : "text-text-muted"} />
                  {data.profiles[id].label}
                </span>
                <span className="block text-xs text-text-secondary">{data.profiles[id].description}</span>
              </button>
            );
          })}
        </div>
      </div>

      <Section
        title="Coding guidelines"
        hint="Your team's rules, in plain language. Violations in changed lines are reported, with the guideline quoted."
      >
        <textarea
          aria-label="Coding guidelines"
          value={form.guidelines}
          onChange={(event) => update({ guidelines: event.target.value })}
          rows={6}
          maxLength={8000}
          placeholder={"- Use the shared logger, never console.log, in services.\n- Every database query goes through the repository layer.\n- Public functions need a doc comment."}
          className={clsx(inputClass, "resize-y")}
        />

        <div className="space-y-2">
          <p className={labelClass}>Path instructions</p>
          {form.pathInstructions.map((entry, index) => (
            <div key={index} className="rounded-lg border border-bg-border bg-bg-base p-2 space-y-2">
              <div className="flex gap-2">
                <input
                  aria-label="Path glob"
                  value={entry.path}
                  onChange={(event) => updatePath(index, { path: event.target.value })}
                  placeholder="src/api/**"
                  className={inputClass}
                  spellCheck={false}
                />
                <button
                  aria-label="Remove path instruction"
                  onClick={() => update({ pathInstructions: form.pathInstructions.filter((_, i) => i !== index) })}
                  className="shrink-0 px-2 text-text-muted hover:text-status-red transition-colors"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <textarea
                aria-label="Instructions for this path"
                value={entry.instructions}
                onChange={(event) => updatePath(index, { instructions: event.target.value })}
                rows={2}
                maxLength={2000}
                placeholder="Every handler validates its input with zod and checks the caller's permissions."
                className={clsx(inputClass, "resize-y")}
              />
            </div>
          ))}
          {form.pathInstructions.length < 25 && (
            <button
              onClick={() => update({ pathInstructions: [...form.pathInstructions, { path: "", instructions: "" }] })}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono text-text-secondary border border-bg-border rounded-lg hover:bg-bg-hover transition-colors"
            >
              <Plus size={12} /> Add path instruction
            </button>
          )}
        </div>
      </Section>

      <Section title="Review style" hint="How much a review says and how it says it.">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label className={labelClass} htmlFor="review-min-severity">Minimum severity</label>
            <select
              id="review-min-severity"
              value={form.minSeverity}
              onChange={(event) => update({ minSeverity: event.target.value as Severity | "" })}
              className={clsx(inputClass, "appearance-none")}
            >
              <option value="">Profile default ({preset.minSeverity})</option>
              {SEVERITIES.map((severity) => (
                <option key={severity} value={severity}>{severity}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={labelClass} htmlFor="review-max-findings">Max findings per review</label>
            <input
              id="review-max-findings"
              inputMode="numeric"
              value={form.maxFindings}
              onChange={(event) => update({ maxFindings: event.target.value.replace(/[^0-9]/g, "") })}
              placeholder={`Profile default (${preset.maxFindings})`}
              className={clsx(inputClass, !maxFindingsValid && "border-status-red/60")}
            />
            {!maxFindingsValid && <p className="text-xs text-status-red">Between 1 and 100.</p>}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={labelClass} htmlFor="review-tone">Tone</label>
          <input
            id="review-tone"
            value={form.tone}
            onChange={(event) => update({ tone: event.target.value })}
            maxLength={500}
            placeholder="Brief and friendly. Explain the why for junior developers."
            className={inputClass}
          />
        </div>
        <Toggle
          checked={form.fixPrompt}
          onChange={(fixPrompt) => update({ fixPrompt })}
          label="Include the “Fix with your AI coding assistant” prompt"
          hint="A copyable prompt at the end of each review that lists every finding."
        />
      </Section>

      <Section title="Workflow" hint="Which pull requests get reviewed, and which files.">
        <div className="space-y-2.5">
          <Toggle
            checked={form.autoReview}
            onChange={(autoReview) => update({ autoReview })}
            label="Review pull requests automatically"
            hint="Off: Lorica does not review this account's pull requests."
          />
          <Toggle
            checked={form.reviewDrafts}
            onChange={(reviewDrafts) => update({ reviewDrafts })}
            label="Review draft pull requests"
            hint="Off: drafts are reviewed once marked ready for review."
          />
          <Toggle
            checked={form.reviewOnPush}
            onChange={(reviewOnPush) => update({ reviewOnPush })}
            label="Re-review on every push"
            hint="Off: only opened, reopened and ready-for-review pull requests are reviewed."
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ["baseBranches", "Base branches", "main, release/*", "Empty reviews pull requests into any branch."],
              ["ignoreTitleKeywords", "Skip titles containing", "WIP, [skip review]", "Case-insensitive."],
              ["ignoreAuthors", "Skip authors", "dependabot[bot], renovate[bot]", "GitHub logins."],
            ] as const
          ).map(([key, label, placeholder, hint]) => (
            <div key={key} className="flex flex-col gap-1.5">
              <label className={labelClass} htmlFor={`review-${key}`}>{label}</label>
              <input
                id={`review-${key}`}
                value={form[key]}
                onChange={(event) => update({ [key]: event.target.value })}
                placeholder={placeholder}
                className={inputClass}
                spellCheck={false}
              />
              <p className={hintClass}>{hint}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={labelClass} htmlFor="review-exclude">Exclude paths</label>
          <textarea
            id="review-exclude"
            value={form.excludePaths}
            onChange={(event) => update({ excludePaths: event.target.value })}
            rows={3}
            placeholder={"**/*.test.ts\nmigrations/**"}
            className={clsx(inputClass, "resize-y")}
            spellCheck={false}
          />
          <p className={hintClass}>
            One glob per line. Lockfiles, generated, vendored and binary files are always skipped.
          </p>
        </div>
      </Section>

      <div className="flex flex-wrap items-center gap-2 border-t border-bg-border pt-4">
        <button
          onClick={save}
          disabled={busy !== null || !dirty || !maxFindingsValid}
          className="px-4 py-2 bg-accent-violet text-white text-xs font-mono rounded-lg hover:bg-accent-violet-dim transition-colors disabled:opacity-50"
        >
          {busy === "save" ? "Saving…" : "Save review settings"}
        </button>
        {data.settings && (
          <button
            onClick={reset}
            disabled={busy !== null}
            className="px-4 py-2 text-xs font-mono text-text-secondary border border-bg-border rounded-lg hover:bg-bg-hover transition-colors disabled:opacity-50"
          >
            {busy === "reset" ? "Resetting…" : "Reset to defaults"}
          </button>
        )}
        {message && (
          <p className={clsx("text-xs font-mono", message.tone === "ok" ? "text-status-green" : "text-status-red")}>
            {message.text}
          </p>
        )}
      </div>

      <details className="rounded-lg border border-bg-border bg-bg-base">
        <summary className="cursor-pointer px-3 py-2 text-xs font-mono text-text-secondary">
          Share with your team as <code>{data.repoConfigFiles[0]}</code>
        </summary>
        <div className="space-y-2 px-3 pb-3">
          <p className={hintClass}>
            Commit this to a repository to version its review settings with the code. It is read from the branch a pull
            request targets, so a pull request cannot change its own review. Shows the saved settings.
          </p>
          <pre className="overflow-x-auto rounded-md border border-bg-border bg-bg-panel p-3 text-xs font-mono text-text-primary">
            {data.yaml}
          </pre>
          <button
            onClick={() => navigator.clipboard?.writeText(data.yaml)}
            className="px-3 py-1.5 text-xs font-mono text-text-secondary border border-bg-border rounded-lg hover:bg-bg-hover transition-colors"
          >
            Copy
          </button>
        </div>
      </details>
    </div>
  );
}
