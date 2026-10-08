// Plugin health: what's wrong with the installed plugins and how to fix it.
// Two sources: BB's own status for every plugin (needs setup, error,
// incompatible, a crashing service), and the `studio_health` checks plugins
// publish for problems only they can see, like a missing API key.
import { HEALTH_METHOD, pluginSettingsPath, type HealthSchemas } from "@bb-studio/kit/health";
import type { z } from "zod";
import type { HealthSummary, Problem } from "./health-contract";

const CALL_TIMEOUT_MS = 10_000;
/** Plugins whose health check may run. Starting ones aren't ready to answer. */
const LIVE_STATES = new Set(["running", "degraded"]);

export interface HealthPluginEntry {
  id: string;
  name: string | null;
  enabled: boolean;
  status: string;
  statusDetail: string | null;
  services?: readonly { name: string; state: string }[];
}

export interface HealthSdk {
  plugins: {
    list(): Promise<{ plugins: readonly HealthPluginEntry[] }>;
    experimental_discoverRpc(args?: { method?: string }): Promise<readonly { pluginId: string }[]>;
    callRpc<T>(args: { pluginId: string; method: string; input?: unknown; outputSchema: z.ZodType<T>; signal?: AbortSignal }): Promise<T>;
    disable(args: { pluginId: string }): Promise<unknown>;
  };
}

type Found = Omit<Problem, "key" | "hidden" | "lasting"> & { checkId: string };

/** BB's own plugin status, as a problem, or null when there's none. */
export function statusProblem(plugin: HealthPluginEntry): Found | null {
  const base = { pluginId: plugin.id, pluginName: plugin.name ?? plugin.id, checkId: "bb-status", fix: { label: "Open settings", path: pluginSettingsPath(plugin.id) } };
  const detail = plugin.statusDetail;
  switch (plugin.status) {
    case "needs-configuration":
      return { ...base, status: "degraded", title: "Needs setup", detail: detail ?? "Finish its settings, then reload it." };
    case "degraded":
      return { ...base, status: "degraded", title: "Running with problems", detail };
    case "error":
      return { ...base, status: "broken", title: "Stopped with an error", detail };
    case "incompatible":
      return { ...base, status: "broken", title: "Doesn't work with this version of BB", detail: detail ?? "Update the plugin, or wait for a BB update." };
    case "missing":
      return { ...base, status: "broken", title: "Its files are missing", detail: detail ?? "Reinstall it, or remove it." };
  }
  const crashing = plugin.services?.filter((service) => service.state === "backoff") ?? [];
  if (crashing.length) {
    return { ...base, checkId: "bb-services", status: "degraded", title: `${crashing.map((service) => service.name).join(", ")} keeps restarting`, detail: "A background service crashed and BB is retrying it. Its log has the error." };
  }
  return null;
}

export function problemKey(problem: Pick<Found, "pluginId" | "checkId" | "status" | "title">): string {
  return JSON.stringify([problem.pluginId, problem.checkId, problem.status, problem.title]);
}

async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("It didn't answer within 10 seconds.")), CALL_TIMEOUT_MS);
  try {
    return await Promise.race([
      run(controller.signal),
      new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true })),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** One pass over every enabled plugin. `hidden` holds the keys the user hid. */
export async function checkHealth(sdk: HealthSdk, schemas: HealthSchemas, hidden: ReadonlySet<string>, now = Date.now()): Promise<HealthSummary> {
  const [{ plugins }, published] = await Promise.all([
    sdk.plugins.list(),
    sdk.plugins.experimental_discoverRpc({ method: HEALTH_METHOD }).catch(() => []),
  ]);
  const enabled = plugins.filter((plugin) => plugin.enabled);
  const found: Found[] = enabled.flatMap((plugin) => statusProblem(plugin) ?? []);
  const reporting = new Set(published.map((method) => method.pluginId));
  const healthy: HealthSummary["healthy"] = [];
  const unanswered: HealthSummary["unanswered"] = [];
  await Promise.all(enabled.filter((plugin) => reporting.has(plugin.id) && LIVE_STATES.has(plugin.status)).map(async (plugin) => {
    const pluginName = plugin.name ?? plugin.id;
    try {
      const { checks } = await withTimeout((signal) => sdk.plugins.callRpc({
        pluginId: plugin.id, method: HEALTH_METHOD, input: {}, outputSchema: schemas.contract[HEALTH_METHOD].output, signal,
      }));
      const passed: string[] = [];
      for (const check of checks) {
        if (check.status === "ok") passed.push(check.title);
        else found.push({
          pluginId: plugin.id, pluginName, checkId: check.id, status: check.status, title: check.title,
          detail: check.detail ?? null, fix: check.fix ?? { label: "Open settings", path: pluginSettingsPath(plugin.id) },
        });
      }
      if (passed.length && !checks.some((check) => check.status !== "ok")) healthy.push({ pluginId: plugin.id, pluginName, titles: passed });
    } catch (error) {
      unanswered.push({ pluginId: plugin.id, pluginName, error: message(error) });
    }
  }));
  const rank = { broken: 0, degraded: 1 } as const;
  const problems = found
    .map(({ checkId, ...problem }) => {
      const key = problemKey({ ...problem, checkId });
      return { ...problem, key, hidden: hidden.has(key), lasting: false };
    })
    .sort((a, b) => rank[a.status] - rank[b.status] || a.pluginName.localeCompare(b.pluginName) || a.title.localeCompare(b.title));
  const byName = (a: { pluginName: string }, b: { pluginName: string }) => a.pluginName.localeCompare(b.pluginName);
  return { checkedAt: now, problems, healthy: healthy.sort(byName), unanswered: unanswered.sort(byName) };
}

const HIDDEN_KEY = "health-hidden";
/** A new problem is checked again this soon, to tell a lasting one from a reload. */
const CONFIRM_MS = 30_000;

/** Keeps the latest result, the problems the user hid, and tells the app when either changes. */
export class HealthMonitor {
  private latest: HealthSummary | null = null;
  private inFlight: Promise<HealthSummary> | null = null;
  /** Changes to the hidden list, one at a time, so a check can't undo a Hide made while it ran. */
  private hiding: Promise<unknown> = Promise.resolve();
  private confirming: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(private readonly deps: {
    sdk: HealthSdk;
    schemas: HealthSchemas;
    kv: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> };
    changed(summary: HealthSummary): void;
    now?: () => number;
  }) {}

  private async hidden(): Promise<Set<string>> {
    const stored = await this.deps.kv.get(HIDDEN_KEY);
    return new Set(Array.isArray(stored) ? stored.filter((key): key is string => typeof key === "string") : []);
  }

  /** The latest result if it's at most `maxAgeMs` old, otherwise a new check. */
  async summary(maxAgeMs: number): Promise<HealthSummary> {
    const now = (this.deps.now ?? Date.now)();
    if (this.latest && now - this.latest.checkedAt <= maxAgeMs) return this.latest;
    return this.check();
  }

  check(): Promise<HealthSummary> {
    this.inFlight ??= this.run().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private editHidden<T>(edit: () => Promise<T>): Promise<T> {
    const run = this.hiding.then(edit, edit);
    this.hiding = run.catch(() => {});
    return run;
  }

  private async run(): Promise<HealthSummary> {
    const checked = await checkHealth(this.deps.sdk, this.deps.schemas, new Set(), (this.deps.now ?? Date.now)());
    // Read the hidden list after the check: the user may have hidden one meanwhile.
    const next = await this.editHidden(async () => {
      const hidden = await this.hidden();
      // A problem that went away and comes back shows again. A plugin whose
      // check didn't answer keeps its hidden problems until it does.
      const silent = new Set(checked.unanswered.map((entry) => entry.pluginId));
      const present = new Set(checked.problems.map((problem) => problem.key));
      const kept = [...hidden].filter((key) => present.has(key) || silent.has(pluginOf(key)));
      if (kept.length !== hidden.size) await this.deps.kv.set(HIDDEN_KEY, kept);
      return { ...checked, problems: checked.problems.map((problem) => ({ ...problem, hidden: hidden.has(problem.key) })) };
    });
    const previous = this.latest;
    const before = new Set(previous?.problems.map((problem) => problem.key));
    next.problems = next.problems.map((problem) => ({ ...problem, lasting: before.has(problem.key) }));
    if (!this.disposed && next.problems.some((problem) => !problem.lasting) && !this.confirming) {
      this.confirming = setTimeout(() => {
        this.confirming = undefined;
        void this.check().catch(() => {});
      }, CONFIRM_MS);
    }
    this.latest = next;
    if (!this.disposed && (!previous || fingerprint(previous) !== fingerprint(next))) this.deps.changed(next);
    return next;
  }

  async hide(key: string, hide: boolean): Promise<HealthSummary> {
    const hidden = await this.editHidden(async () => {
      const hidden = await this.hidden();
      if (hide) hidden.add(key);
      else hidden.delete(key);
      await this.deps.kv.set(HIDDEN_KEY, [...hidden]);
      return hidden;
    });
    if (this.latest) {
      this.latest = { ...this.latest, problems: this.latest.problems.map((problem) => ({ ...problem, hidden: hidden.has(problem.key) })) };
      this.deps.changed(this.latest);
      return this.latest;
    }
    return this.check();
  }

  dispose(): void {
    // A check still running finishes without scheduling another or telling the app.
    this.disposed = true;
    clearTimeout(this.confirming);
  }

  async disable(pluginId: string): Promise<HealthSummary> {
    await this.deps.sdk.plugins.disable({ pluginId });
    return this.check();
  }
}

function pluginOf(key: string): string {
  try {
    const parsed: unknown = JSON.parse(key);
    return Array.isArray(parsed) && typeof parsed[0] === "string" ? parsed[0] : "";
  } catch {
    return "";
  }
}

const fingerprint = (summary: HealthSummary) => JSON.stringify({ ...summary, checkedAt: 0 });
