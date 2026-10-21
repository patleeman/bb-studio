// Built-in Bot housekeeping. Every destructive decision is recomputed before
// execution; unknown ownership, targets or workspace status fail closed.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { z } from "zod";

type Sdk = BbPluginApi["sdk"];
type Thread = Awaited<ReturnType<Sdk["threads"]["list"]>>[number];
const DAY = 86_400_000;
export const maintenanceRules = ["threads", "workers", "automations", "runtimes", "memory", "skills", "adopt"] as const;
export type MaintenanceRule = typeof maintenanceRules[number];
export interface MaintenanceSettings { enabled: boolean; enabledAt: number | null; memoryWords: number; rules: Record<MaintenanceRule, boolean> }
export interface MaintenanceRun { at: number; dryRun: boolean; summary: string; actions: string[]; needsCall: { threadId: string; title: string; reason: string }[]; suggestions: { text: string; threadId?: string; automationId?: string }[] }
export interface MaintenanceView { settings: MaintenanceSettings; liveAt: number | null; runs: MaintenanceRun[] }
export function maintenanceDefaults(): MaintenanceSettings { return { enabled: false, enabledAt: null, memoryWords: 8000, rules: Object.fromEntries(maintenanceRules.map((rule) => [rule, true])) as MaintenanceSettings["rules"] }; }
export function maintenanceDryRun(settings: MaintenanceSettings, now: number): boolean { return !settings.enabled || settings.enabledAt === null || now < settings.enabledAt + DAY; }
export function finished(thread: Pick<Thread, "status" | "hasPendingInteraction" | "activity" | "queuedWork">, targeted: boolean, interactions: readonly { status: string }[]): boolean {
  return thread.status === "idle" && !thread.hasPendingInteraction && !targeted && thread.queuedWork === "none" && Object.values(thread.activity).every((count) => count === 0) && !interactions.some((i) => i.status === "pending" || i.status === "resolving");
}
export function archiveAge(worker: boolean, captured: boolean, ownerReplied: boolean): number { return (worker ? ownerReplied ? 1 : 3 : captured ? 3 : 7) * DAY; }
export function safeWorkspace(status: Awaited<ReturnType<Sdk["environments"]["status"]>>): boolean {
  // 0.6.37 has no upstream/push count. A local merge base cannot prove
  // commits were pushed: accept only zero ahead of a remote tracking branch
  // for this exact branch. `baseRef` is the merge-base commit SHA, so use the
  // requested `mergeBaseBranch` ref to prove it is remote-tracking.
  if (status.outcome !== "available") return false;
  const { checkout, mergeBase, workingTree } = status.workspace;
  if (checkout.kind !== "branch" || !mergeBase?.mergeBaseBranch) return false;
  const remote = /^(?:refs\/remotes\/)?[^/]+\/(.+)$/.exec(mergeBase.mergeBaseBranch)?.[1];
  return remote === checkout.branchName && !mergeBase.mergeBaseBranch.startsWith("refs/heads/") && workingTree.state === "clean" && !workingTree.hasUncommittedChanges && mergeBase.aheadCount === 0 && !mergeBase.hasCommittedUnmergedChanges;
}
export function memoryNeedsTidy(text: string, budget: number, updatedAt: number, now: number): boolean {
  const dates = [...text.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)].map((m) => Date.parse(m[1]!)).filter(Number.isFinite);
  return text.trim().split(/\s+/).filter(Boolean).length > budget || (text.trim().length > 0 && now - Math.min(updatedAt, ...dates) >= 60 * DAY);
}
const automation = z.object({ id: z.string(), name: z.string().optional(), updatedAt: z.number().optional(), enabled: z.boolean(), lastRunAt: z.number().nullish(), nextRunAt: z.number().nullish(), lastRunStatus: z.string().nullish(), createdByThreadId: z.string().nullish(), execution: z.object({ targetThreadId: z.string().nullish(), prompt: z.string().optional() }).passthrough(), trigger: z.object({ cron: z.string().optional() }).passthrough() }).passthrough();
const overview = z.object({ automations: z.array(z.object({ automation, project: z.object({ id: z.string() }).passthrough() }).passthrough()) }).passthrough();
export interface MaintenanceDeps {
  db: Database.Database; sdk: Sdk; changed(): void;
  bots(): { id: string; threadId: string | null; state: string; kind?: string }[];
  owned(botId: string): ReadonlySet<string>;
  refreshOwned(): Promise<unknown>;
  memory(botId: string): { id: string; markdown: string; updatedAt: number } | null;
  curate(botId: string, dryRun: boolean): Promise<{ result: string }>;
  automationPause(id: string, botId: string): Promise<unknown>;
  automationDelete(id: string, botId: string): Promise<unknown>;
  adoptable(botId: string): Promise<{ threadId: string; title: string; automationId: string; cron: string | null }[]>;
  alert(botId: string, line: string): Promise<void>;
}
type LocalAutomation = { id: string; name: string; kind: string; state: string; instruction: string; target: string; target_thread_id: string | null; updated_at: number; last_fired_at: number | null; schedule_json: string; bb_ids: string; project_id: string };
export class BotMaintenance {
  private running = new Set<string>();
  constructor(private readonly deps: MaintenanceDeps) {}
  view(botId: string): MaintenanceView {
    const row = this.deps.db.prepare("SELECT settings FROM bot_maintenance_settings WHERE bot_id = ? ORDER BY id DESC LIMIT 1").get(botId) as { settings: string } | undefined;
    const settings = row ? JSON.parse(row.settings) as MaintenanceSettings : maintenanceDefaults();
    const runs = (this.deps.db.prepare("SELECT result FROM bot_maintenance_runs WHERE bot_id = ? ORDER BY id DESC LIMIT 30").all(botId) as { result: string }[]).map((r) => JSON.parse(r.result) as MaintenanceRun);
    return { settings, liveAt: settings.enabled && settings.enabledAt !== null ? settings.enabledAt + DAY : null, runs };
  }
  async set(botId: string, patch: { enabled?: boolean; memoryWords?: number; rules?: Partial<Record<MaintenanceRule, boolean>> }, now = Date.now()): Promise<MaintenanceView> {
    const previous = this.view(botId).settings;
    const settings = { ...previous, ...patch, rules: { ...previous.rules, ...patch.rules }, enabledAt: patch.enabled === true && !previous.enabled ? now : previous.enabledAt };
    this.deps.db.prepare("INSERT INTO bot_maintenance_settings (bot_id, at, settings) VALUES (?, ?, ?)").run(botId, now, JSON.stringify(settings));
    this.deps.changed();
    if (settings.enabled && !previous.enabled) await this.run(botId, { dryRun: true, now });
    return this.view(botId);
  }
  async olderThreads(botId: string) {
    const threads: Thread[] = [];
    const owned = this.deps.owned(botId);
    for (const archived of [false, true]) for (let offset = 0; ; offset += 200) {
      const batch = await this.deps.sdk.threads.list({ archived, includeHidden: true, limit: 200, offset });
      threads.push(...batch.filter((t) => owned.has(t.id) && (t.archivedAt || Date.now() - t.updatedAt >= 7 * DAY) && !t.hasPendingInteraction && t.status === "idle"));
      if (batch.length < 200) break;
    }
    return threads.map((t) => ({ id: t.id, title: t.title || t.titleFallback || "Untitled thread", status: t.status, projectId: t.projectId, updatedAt: t.updatedAt, relation: "started" as const, needsYou: t.hasPendingInteraction, parentId: null }));
  }
  async tick(now = Date.now(), heartbeatBotId?: string): Promise<void> {
    for (const bot of this.deps.bots()) {
      if (heartbeatBotId && heartbeatBotId !== bot.id) continue;
      const view = this.view(bot.id);
      if (!view.settings.enabled || bot.state !== "active" || bot.kind === "external") continue;
      const last = view.runs[0];
      const date = new Date(now);
      if (!heartbeatBotId && date.getHours() < 4) continue;
      if (last && new Date(last.at).toDateString() === date.toDateString()) continue;
      const boundary = new Date(now); boundary.setHours(4, 0, 0, 0);
      if (date < boundary) boundary.setDate(boundary.getDate() - 1);
      if (heartbeatBotId ? last && new Date(last.at).toDateString() === date.toDateString() : last && last.at >= boundary.getTime()) continue;
      await this.run(bot.id, { now });
    }
  }
  async run(botId: string, options: { dryRun?: boolean; now?: number } = {}): Promise<MaintenanceRun | null> {
    const bot = this.deps.bots().find((b) => b.id === botId);
    if (!bot || bot.state !== "active" || bot.kind === "external" || this.running.has(botId)) return null;
    const now = options.now ?? Date.now();
    const settings = this.view(botId).settings;
    const dryRun = options.dryRun === true || maintenanceDryRun(settings, now);
    this.running.add(botId);
    const result: MaintenanceRun = { at: now, dryRun, summary: "", actions: [], needsCall: [], suggestions: [] };
    let recorded = false;
    try {
      const act = async (text: string, apply: () => Promise<unknown> | unknown) => { if (!dryRun) await apply(); result.actions.push(text); };
      if (!dryRun) await this.deps.refreshOwned();
      // If the overview is unavailable, abort. Never archive against an incomplete target list.
      const external = await this.deps.sdk.plugins.callRpc({ pluginId: "automations", method: "automations_overview", input: null, outputSchema: overview });
      const targets = new Set(external.automations.filter((a) => a.automation.enabled).flatMap((a) => a.automation.execution.targetThreadId ? [a.automation.execution.targetThreadId] : []));
      const locals = this.deps.db.prepare("SELECT * FROM bot_automations WHERE bot_id = ? ORDER BY created_at, id").all(botId) as LocalAutomation[];
      for (const row of this.deps.db.prepare("SELECT target_thread_id FROM bot_automations WHERE state = 'active'").all() as { target_thread_id: string | null }[]) if (row.target_thread_id) targets.add(row.target_thread_id);
      for (const row of this.deps.db.prepare("SELECT thread_id FROM bot_runners").all() as { thread_id: string | null }[]) if (row.thread_id) targets.add(row.thread_id);
      const running = new Set((await this.deps.sdk.threads.listRunning()).map((t) => t.id));
      const owned = this.deps.owned(botId);
      const listed = new Map<string, Thread>();
      for (let offset = 0; ; offset += 200) {
        const batch = await this.deps.sdk.threads.list({ archived: false, includeHidden: true, limit: 200, offset });
        for (const thread of batch) listed.set(thread.id, thread);
        if (batch.length < 200) break;
      }
      let archived = 0, workers = 0;
      for (const id of owned) {
        const thread = listed.get(id);
        if (!thread || thread.archivedAt || running.has(id)) continue;
        const worker = thread.visibility === "hidden" && (!!thread.lifecycleOwnerThreadId || !!thread.sourceThreadId || /skill review|worker|sub.agent/i.test(thread.title ?? ""));
        if (!(worker ? settings.rules.workers : settings.rules.threads)) continue;
        const interactions = await this.deps.sdk.threads.interactions.list({ threadId: id });
        if (!finished(thread, targets.has(id), interactions)) continue;
        const plans = await this.deps.sdk.threads.events.list({ threadId: id, order: "desc", limit: "1", types: ["turn/plan/updated"] });
        if (plans.some((p) => (p.data as { plan?: { status: string }[] }).plan?.some((s) => s.status !== "completed"))) continue;
        let captured = !!this.deps.db.prepare("SELECT 1 FROM item_threads WHERE thread_id = ? LIMIT 1").get(id);
        if (!captured && thread.environmentId) {
          const pr = await this.deps.sdk.environments.pullRequest({ environmentId: thread.environmentId }).catch(() => null);
          captured = pr?.outcome === "available" && pr.pullRequest.attention === "merged";
        }
        const ownerId = thread.lifecycleOwnerThreadId ?? thread.parentThreadId ?? thread.sourceThreadId;
        const owner = worker && ownerId ? await this.deps.sdk.threads.get({ threadId: ownerId }).catch(() => null) : null;
        // updatedAt can change on rename: require a real owner turn after the worker.
        const replies = owner ? await this.deps.sdk.threads.events.list({ threadId: owner.id, order: "desc", limit: "1", types: ["turn/completed"] }) : [];
        const ownerReplied = replies.some((e) => e.createdAt > thread.updatedAt);
        if (now - thread.updatedAt < archiveAge(worker, captured, ownerReplied)) continue;
        const fresh = await this.deps.sdk.threads.get({ threadId: id });
        if (fresh.archivedAt || fresh.environmentId !== thread.environmentId || fresh.queuedMessageCount > 0 || fresh.updatedAt !== thread.updatedAt || fresh.status !== "idle" || fresh.activeBackgroundAgentCount > 0 || (await this.deps.sdk.threads.interactions.list({ threadId: id })).some((i) => i.status === "pending" || i.status === "resolving")) continue;
        const live = await this.deps.sdk.plugins.callRpc({ pluginId: "automations", method: "automations_overview", input: null, outputSchema: overview });
        if (live.automations.some((a) => a.automation.enabled && a.automation.execution.targetThreadId === id)) continue;
        if (thread.environmentId || thread.environmentPath) {
          const status = thread.environmentId && thread.environmentBranchName
            ? await this.deps.sdk.environments.status({ environmentId: thread.environmentId, mergeBaseBranch: `origin/${thread.environmentBranchName}` }).catch(() => null)
            : null;
          if (!status || !safeWorkspace(status)) { result.needsCall.push({ threadId: id, title: thread.title || thread.titleFallback || id, reason: "Workspace is dirty, has unpushed commits, or clean/pushed status could not be confirmed." }); continue; }
        }
        if (!this.deps.owned(botId).has(id) || this.deps.bots().find((b) => b.id === botId)?.state !== "active") continue;
        await act(`Archive ${worker ? "worker" : "thread"}: ${thread.title || id}`, () => this.deps.sdk.threads.archive({ threadId: id }));
        if (worker) workers++; else archived++;
      }
      if (settings.rules.automations) {
        const seen = new Set<string>();
        for (const row of locals) {
          const age = now - row.updated_at;
          if (row.kind === "reminder" && row.state === "done" && age >= 14 * DAY) { await act(`Delete done reminder: ${row.name}`, () => this.deps.automationDelete(row.id, botId)); continue; }
          if (row.state === "paused" && age >= 30 * DAY) result.suggestions.push({ text: `Suggest delete: ${row.name} (disabled over 30 days)` });
          if (row.state === "ended" && row.kind === "checkin") await act(`Move finished check-in to Done: ${row.name}`, () => this.deps.db.prepare("UPDATE bot_automations SET state = 'done', updated_at = ? WHERE id = ?").run(now, row.id));
          if (row.state !== "active") continue;
          if (row.kind === "reminder") {
            const bbIds = JSON.parse(row.bb_ids) as string[];
            const backing = external.automations.filter((a) => bbIds.includes(a.automation.id)).map((a) => a.automation);
            if (backing.length === bbIds.length && backing.length > 0 && backing.every((a) => a.lastRunAt && a.lastRunStatus === "succeeded" && !a.nextRunAt)) {
              await act(`Move done reminder to Done: ${row.name}`, () => this.deps.db.prepare("UPDATE bot_automations SET state = 'done', updated_at = ? WHERE id = ?").run(now, row.id));
            }
            continue;
          }
          const targetId = row.target === "main" ? bot.threadId : (this.deps.db.prepare("SELECT thread_id FROM bot_runners WHERE id = ?").get(row.target) as { thread_id: string | null } | undefined)?.thread_id;
          const target = targetId ? await this.deps.sdk.threads.get({ threadId: targetId }).catch((error) => { if ((error as { status?: number }).status === 404 || /not found/i.test(String(error))) return null; throw error; }) : null;
          const retired = !target || !!target.archivedAt;
          const signature = JSON.stringify([targetId, row.instruction.trim(), row.kind === "watcher" ? row.id : ""]);
          const duplicate = seen.has(signature); seen.add(signature);
          if (retired || duplicate) { await act(`Pause ${retired ? "retired target" : "duplicate"}: ${row.name}`, () => this.deps.automationPause(row.id, botId)); result.suggestions.push({ text: `${row.name}: ${retired ? "target retired or missing" : "duplicate instruction and target"}` }); continue; }
          const ids = JSON.parse(row.bb_ids) as string[];
          const runs = (await Promise.all(ids.map((automationId) => this.deps.sdk.plugins.callRpc({ pluginId: "automations", method: "automations_runs", input: { projectId: row.project_id, automationId, limit: 10 }, outputSchema: z.object({ runs: z.array(z.object({ status: z.string(), output: z.string().nullish(), finishedAt: z.number().nullish() }).passthrough()) }).passthrough() })))).flatMap((p) => p.runs).sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0)).slice(0, 10);
          if (runs.length === 10 && runs.every((r) => r.status === "succeeded" && (!r.output?.trim() || r.output.trim() === "[PASS]"))) result.suggestions.push({ text: `Review ${row.name}: no useful output in its last 10 runs` });
        }
      }
      if (settings.rules.automations) {
        const localIds = new Set(locals.flatMap((r) => JSON.parse(r.bb_ids) as string[]));
        const seen = new Set<string>();
        for (const entry of external.automations) {
          const a = entry.automation;
          if (localIds.has(a.id) || !a.createdByThreadId || (a.createdByThreadId !== bot.threadId && !owned.has(a.createdByThreadId))) continue;
          const name = a.name ?? a.id;
          if (!a.enabled) { if (a.updatedAt && now - a.updatedAt >= 30 * DAY) result.suggestions.push({ text: `Suggest delete: ${name} (disabled over 30 days)` }); continue; }
          if (!a.trigger.cron) continue;
          const targetId = a.execution.targetThreadId;
          const target = targetId ? await this.deps.sdk.threads.get({ threadId: targetId }).catch((error) => { if ((error as { status?: number }).status === 404 || /not found/i.test(String(error))) return null; throw error; }) : undefined;
          const retired = targetId ? !target || !!target.archivedAt : false;
          const signature = JSON.stringify([targetId ?? "new-thread", a.execution.prompt?.trim()]);
          const duplicate = !!a.execution.prompt && seen.has(signature); seen.add(signature);
          if (retired || duplicate) {
            await act(`Pause ${retired ? "retired target" : "duplicate"}: ${name}`, () => this.deps.sdk.plugins.callRpc({ pluginId: "automations", method: "automations_pause", input: { projectId: entry.project.id, automationId: a.id }, outputSchema: z.unknown() }));
            result.suggestions.push({ text: `${name}: ${retired ? "target retired or missing" : "duplicate instruction and target"}` });
            continue;
          }
          const page = await this.deps.sdk.plugins.callRpc({ pluginId: "automations", method: "automations_runs", input: { projectId: entry.project.id, automationId: a.id, limit: 10 }, outputSchema: z.object({ runs: z.array(z.object({ status: z.string(), output: z.string().nullish() }).passthrough()) }).passthrough() });
          if (page.runs.length === 10 && page.runs.every((r) => r.status === "succeeded" && (!r.output?.trim() || r.output.trim() === "[PASS]"))) result.suggestions.push({ text: `Review ${name}: no useful output in its last 10 runs` });
        }
      }

      // The stable SDK lists running turns, but cannot identify loaded idle
      // runtimes. Do not stop threads based solely on their last update time.
      if (settings.rules.memory && bot.threadId) {
        const memory = this.deps.memory(botId);
        if (memory && memoryNeedsTidy(memory.markdown, settings.memoryWords, memory.updatedAt, now)) await act("Memory tidy requested", () => this.deps.sdk.threads.send({ threadId: bot.threadId!, mode: "auto", input: [{ type: "text", text: `Maintenance: rewrite Memory page ${memory.id}. Merge duplicates, drop entries older than 60 days that are stale or contradicted, preserve useful facts, and stay under ${settings.memoryWords} words. Page history preserves the old version. Reply exactly [PASS].`, mentions: [], visibility: "agent-only" }] }));
      }
      if (settings.rules.skills) { const skills = await this.deps.curate(botId, dryRun); result.actions.push(`Skills: ${skills.result}`); }
      if (settings.rules.adopt) for (const candidate of await this.deps.adoptable(botId)) if (candidate.cron) result.suggestions.push({ text: `Consider adopting ${candidate.title} as a runner`, threadId: candidate.threadId, automationId: candidate.automationId });
      result.summary = `${dryRun ? "Dry run: would archive" : "Archived"} ${archived} finished threads, ${workers} workers; ${result.actions.filter((a) => !a.startsWith("Archive")).join("; ") || "nothing else to tidy"}`;
      this.deps.db.prepare("INSERT INTO bot_maintenance_runs (bot_id, at, result) VALUES (?, ?, ?)").run(botId, now, JSON.stringify(result));
      recorded = true;
      this.deps.changed();
      if (!dryRun && result.needsCall.length) await this.deps.alert(botId, `Maintenance: ${result.needsCall.length} threads need your call in Bot info → Maintenance.`);
      return result;
    } catch (error) {
      if (recorded) throw error;
      result.summary = `${dryRun ? "Dry run" : "Maintenance"} stopped: ${error instanceof Error ? error.message : String(error)}`;
      this.deps.db.prepare("INSERT INTO bot_maintenance_runs (bot_id, at, result) VALUES (?, ?, ?)").run(botId, now, JSON.stringify(result));
      this.deps.changed();
      return result;
    } finally { this.running.delete(botId); }
  }
}
