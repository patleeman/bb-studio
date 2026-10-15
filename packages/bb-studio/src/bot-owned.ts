// Bot-owned threads: every thread a Bot uses lives under that Bot in Studio
// (Bots panel, Activity), not in BB's main thread list. That is the Bot's
// own chain (its chat and the threads it handed off from) and the work it
// started. BB's main list keeps the threads the user made.
//
// A thread is owned by a Bot when
//   (a) the Bot's chain (its thread and the ones it handed off from) spawned
//       it at any depth: BB's parentThreadId or lifecycleOwnerThreadId. A
//       fork (sourceThreadId only) is the user's, not owned; or
//   (b) an automation started it, and the Bot's chain or a thread it owns
//       created that automation (createdByThreadId), transitively: a child
//       the Bot spawned sets up an automation, and each run's new thread is
//       the Bot's too.
// The Bot's chain is hidden too: by the sweep and thread.created, and at
// once when a Bot gets a thread (made, set, or handed off: claimChains).
// Runner threads are hidden by src/runners.ts and skipped here.
//
// How: thread.created hides a thread whose parent or owner is already known
// to be the Bot's at once, and asks for a sweep otherwise (an automation's
// run is linked to its thread only after BB creates it). The sweep (at
// startup, every few minutes and after such a thread) walks every
// unarchived thread, hidden ones included, and BB's automations. A run's
// thread comes from automations_runs (structured); a thread too old for the
// runs page falls back to the "[bb automation due:<id>]" its first message
// starts with.
//
// The user can also hand a Bot a thread (drag it onto the Bot in the
// sidebar: adopt). It's hidden and recorded as "adopted"; that wins over any
// other owner, and what the thread spawns is the Bot's too. The Bot's chat
// gets a line saying so (handed). Dragged back onto Threads, the user takes
// it back (release): shown again and recorded as "released", so it's no
// Bot's, nor is what it spawns, and no sweep hides it again.
//
// Studio records each thread it hid (bot_hidden_threads) and never hides a
// thread twice: a thread the user made visible again stays visible, the
// Bot's own chat included.
//
// BB's threads.list drops hidden threads unless includeHidden is set, so
// every Studio read of a Bot's threads (Activity, Bots list) passes it.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { z } from "zod";

type Sdk = BbPluginApi["sdk"];
type Listed = Awaited<ReturnType<Sdk["threads"]["list"]>>[number];
type ThreadLike = Pick<Listed, "id"> & Partial<Pick<Listed, "parentThreadId" | "lifecycleOwnerThreadId" | "originPluginId" | "title" | "titleFallback" | "visibility" | "archivedAt">>;

/** The marker BB's automations put at the start of a new-thread run's first message (and so its fallback title). */
const AUTOMATION_DUE = /^\[bb automation due:([^\]\s]+)\]/;
const PAGE = 200;
const MAX_PAGES = 50;

const automationEntry = z.object({
  id: z.string(), projectId: z.string().optional(),
  createdByThreadId: z.string().nullish(),
  execution: z.object({ targetThreadId: z.string().nullish() }).passthrough(),
}).passthrough();
type AutomationEntry = z.infer<typeof automationEntry> & { projectId: string };
const overview = z.object({ automations: z.array(z.object({ automation: z.unknown(), project: z.object({ id: z.string() }).passthrough() }).passthrough()) }).passthrough();
const runs = z.object({ runs: z.array(z.object({ threadId: z.string().nullish() }).passthrough()), nextCursor: z.string().nullish() }).passthrough();

/** The automation whose run started this thread, from its first message's marker. */
export function automationMarker(thread: Pick<ThreadLike, "originPluginId" | "title" | "titleFallback">): string | null {
  if (thread.originPluginId && thread.originPluginId !== "automations") return null;
  for (const text of [thread.titleFallback, thread.title]) {
    const id = text ? AUTOMATION_DUE.exec(text)?.[1] : undefined;
    if (id) return id;
  }
  return null;
}

/**
 * Which Bot owns each thread: `chains` maps every Bot's chain thread to the
 * Bot; `runThreads` maps a run's thread to its automation. Chain threads
 * themselves are not in the result.
 */
export function ownedThreads(threads: readonly ThreadLike[], automations: readonly Pick<AutomationEntry, "id" | "createdByThreadId" | "execution">[], chains: ReadonlyMap<string, string>, runThreads: ReadonlyMap<string, string> = new Map()): Map<string, string> {
  const owners = new Map(chains);
  const automationOwner = new Map<string, string>();
  for (let grew = true; grew;) {
    grew = false;
    for (const automation of automations) {
      const by = automation.createdByThreadId;
      // A target-thread automation wakes a thread that exists; only new-thread runs make one.
      if (automationOwner.has(automation.id) || automation.execution.targetThreadId || !by || !owners.has(by)) continue;
      automationOwner.set(automation.id, owners.get(by)!);
      grew = true;
    }
    for (const thread of threads) {
      if (owners.has(thread.id)) continue;
      const via = [thread.parentThreadId, thread.lifecycleOwnerThreadId].find((id) => !!id && owners.has(id));
      const automation = via ? null : runThreads.get(thread.id) ?? automationMarker(thread);
      const bot = via ? owners.get(via) : automation ? automationOwner.get(automation) : undefined;
      if (!bot) continue;
      owners.set(thread.id, bot);
      grew = true;
    }
  }
  for (const id of chains.keys()) owners.delete(id);
  return owners;
}

export interface OwnedBot { id: string; chain: readonly string[] }
export interface BotOwnedDeps {
  db: Database.Database;
  sdk: Sdk;
  /** Every Bot with its chain (its thread and the ones it handed off from). */
  bots(): readonly OwnedBot[];
  /** Threads hidden elsewhere (runners): left alone here. */
  skip?(): ReadonlySet<string>;
  changed?(): void;
  /** A thread the user just handed a Bot (adopt), to tell the Bot. Not on a repeat drop. */
  handed?(thread: { id: string; title: string; projectId: string | null }, botId: string): Promise<void>;
  log?(message: string): void;
  /** How long thread.created waits before a sweep (an automation links its run after the thread exists). */
  sweepDelayMs?: number;
}

export class BotOwnedThreads {
  /** Each owned thread's Bot, from the last sweep and thread.created. */
  private owners = new Map<string, string>();
  private running: Promise<number> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: BotOwnedDeps) {}

  private chains(): Map<string, string> {
    return new Map(this.deps.bots().flatMap((bot) => bot.chain.map((id) => [id, bot.id] as const)));
  }

  /** Threads the user handed to a Bot, each with that Bot. */
  private adopted(): Map<string, string> {
    return new Map((this.deps.db.prepare("SELECT thread_id, bot_id FROM bot_hidden_threads WHERE reason = 'adopted'").all() as { thread_id: string; bot_id: string }[]).map((row) => [row.thread_id, row.bot_id]));
  }

  /** Threads the user took back from a Bot. */
  private released(): Set<string> {
    return new Set((this.deps.db.prepare("SELECT thread_id FROM bot_hidden_threads WHERE reason = 'released'").all() as { thread_id: string }[]).map((row) => row.thread_id));
  }

  private recorded(): Set<string> {
    return new Set((this.deps.db.prepare("SELECT thread_id FROM bot_hidden_threads").all() as { thread_id: string }[]).map((row) => row.thread_id));
  }

  /** The threads a Bot owns (as last seen), its chain left out: Activity lists them under it. */
  owned(botId: string): Set<string> {
    const ids = new Set([...this.owners].filter(([, bot]) => bot === botId).map(([id]) => id));
    for (const row of this.deps.db.prepare("SELECT thread_id FROM bot_hidden_threads WHERE bot_id = ? AND reason != 'released'").all(botId) as { thread_id: string }[]) ids.add(row.thread_id);
    for (const [id, bot] of this.adopted()) if (bot !== botId) ids.delete(id);
    for (const id of this.chains().keys()) ids.delete(id);
    return ids;
  }

  /** Every thread any Bot has: its chain, the threads it owns as last seen, and the ones Studio hid for it. */
  all(): Set<string> {
    const released = this.released();
    return new Set([...this.chains().keys(), ...this.owners.keys(), ...[...this.recorded()].filter((id) => !released.has(id))]);
  }

  /**
   * The Bot a thread belongs to (its chain, a thread it owns as last seen, or
   * one Studio hid for it, runners included), or null. The browser asks this
   * to keep the Bots list in BB's sidebar while such a thread is open.
   */
  ownerOf(threadId: string): string | null {
    const chained = this.chains().get(threadId) ?? this.adopted().get(threadId) ?? this.owners.get(threadId);
    if (chained) return chained;
    const row = this.deps.db.prepare("SELECT bot_id FROM bot_hidden_threads WHERE thread_id = ? AND reason != 'released'").get(threadId) as { bot_id: string } | undefined;
    return row?.bot_id ?? null;
  }

  /**
   * The user hands a thread to a Bot: it moves under the Bot (hidden from
   * BB's list), from another Bot too. A Bot's own chat or a runner can't move.
   */
  async adopt(threadId: string, botId: string): Promise<{ botId: string }> {
    const chained = this.chains().get(threadId);
    if (chained) throw new Error(chained === botId ? "That's already this bot's chat." : "That's another bot's chat; it can't move.");
    if (this.deps.skip?.().has(threadId)) throw new Error("That's a runner; it stays with its bot.");
    if (this.adopted().get(threadId) === botId) return { botId };
    const thread = await this.deps.sdk.threads.get({ threadId }).catch(() => null) as ThreadLike | null;
    if (!thread || thread.archivedAt) throw new Error("That thread isn't there anymore.");
    if (thread.visibility !== "hidden") await this.deps.sdk.threads.update({ threadId, visibility: "hidden" } as never);
    this.deps.db.prepare("INSERT INTO bot_hidden_threads (thread_id, bot_id, reason, hidden_at) VALUES (?, ?, 'adopted', ?) ON CONFLICT (thread_id) DO UPDATE SET bot_id = excluded.bot_id, reason = excluded.reason, hidden_at = excluded.hidden_at").run(threadId, botId, Date.now());
    this.owners.set(threadId, botId);
    this.deps.changed?.();
    const title = thread.title || thread.titleFallback || "Untitled thread";
    await this.deps.handed?.({ id: threadId, title, projectId: (thread as { projectId?: string | null }).projectId ?? null }, botId).catch((error) => this.deps.log?.(`Couldn't tell the bot about ${threadId}: ${(error as Error)?.message ?? error}`));
    return { botId };
  }

  /** The user takes a thread back from its Bot: shown in BB's list again, and no Bot's from now on. */
  async release(threadId: string): Promise<{ ok: true }> {
    const bot = this.ownerOf(threadId);
    if (!bot) throw new Error("That thread isn't a bot's.");
    if (this.chains().has(threadId)) throw new Error("That's the bot's own chat; it stays with the bot.");
    if (this.deps.skip?.().has(threadId)) throw new Error("That's a runner; it stays with its bot.");
    await this.deps.sdk.threads.update({ threadId, visibility: "visible" } as never);
    this.deps.db.prepare("INSERT INTO bot_hidden_threads (thread_id, bot_id, reason, hidden_at) VALUES (?, ?, 'released', ?) ON CONFLICT (thread_id) DO UPDATE SET reason = excluded.reason, hidden_at = excluded.hidden_at").run(threadId, bot, Date.now());
    this.owners.delete(threadId);
    this.deps.changed?.();
    return { ok: true };
  }

  /** Hides it once and records that Studio did; false when BB refused (the next sweep tries again). */
  private async hide(threadId: string, botId: string, reason: "chain" | "spawned" | "automation"): Promise<boolean> {
    try {
      await this.deps.sdk.threads.update({ threadId, visibility: "hidden" } as never);
    } catch (error) {
      this.deps.log?.(`Couldn't hide ${threadId}: ${(error as Error)?.message ?? error}`);
      return false;
    }
    this.deps.db.prepare("INSERT OR IGNORE INTO bot_hidden_threads (thread_id, bot_id, reason, hidden_at) VALUES (?, ?, ?, ?)").run(threadId, botId, reason, Date.now());
    return true;
  }

  private eligible(thread: ThreadLike, recorded: ReadonlySet<string>): boolean {
    return thread.visibility !== "hidden" && !thread.archivedAt && !recorded.has(thread.id) && !this.deps.skip?.().has(thread.id);
  }

  /**
   * A Bot got a thread (made, set as its thread, or handed off to): hides
   * each chain thread Studio never hid, at once. Returns how many it hid.
   */
  async claimChains(): Promise<number> {
    const chains = this.chains();
    const recorded = this.recorded();
    let hid = 0;
    for (const [threadId, botId] of chains) {
      if (recorded.has(threadId)) continue;
      const thread = await this.deps.sdk.threads.get({ threadId }).catch(() => null);
      if (!thread || !this.eligible(thread as ThreadLike, recorded)) continue;
      if (await this.hide(threadId, botId, "chain")) hid++;
    }
    if (hid) this.deps.changed?.();
    return hid;
  }

  /** thread.created: a Bot's chain thread or a child of a known Bot thread hides now; one that may be an automation's run waits for a sweep. */
  async created(thread: ThreadLike): Promise<void> {
    const chains = this.chains();
    if (!chains.size || !this.eligible(thread, this.recorded())) return;
    const chained = chains.get(thread.id);
    if (chained) {
      if (await this.hide(thread.id, chained, "chain")) this.deps.changed?.();
      return;
    }
    const known = (id: string | null | undefined) => id ? chains.get(id) ?? this.owners.get(id) : undefined;
    const via = known(thread.parentThreadId) ?? known(thread.lifecycleOwnerThreadId);
    if (via) {
      this.owners.set(thread.id, via);
      if (await this.hide(thread.id, via, "spawned")) this.deps.changed?.();
      return;
    }
    if (thread.parentThreadId || thread.lifecycleOwnerThreadId || thread.originPluginId === "automations" || automationMarker(thread)) this.later();
  }

  /** A sweep soon, once (debounced). */
  later(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.sweep().catch((error) => this.deps.log?.(`Bot thread sweep failed: ${(error as Error)?.message ?? error}`)); }, this.deps.sweepDelayMs ?? 3000);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Finds every Bot-owned thread, the Bots' chains included, and hides the ones Studio never hid. Idempotent; returns how many it hid. */
  sweep(): Promise<number> {
    this.running ??= this.run().finally(() => { this.running = null; });
    return this.running;
  }

  private async run(): Promise<number> {
    const chains = this.chains();
    if (!chains.size) return 0;
    const [listed, automations] = await Promise.all([this.threads(), this.automations()]);
    // A thread the user took back is no Bot's, and nothing reaches the Bot through it.
    const released = this.released();
    const threads = listed.filter((thread) => !released.has(thread.id));
    // Adopted threads seed ownership as a chain does, and keep their Bot.
    const adopted = this.adopted();
    const seeds = new Map([...adopted, ...chains]);
    const own = (runThreads?: ReadonlyMap<string, string>) => new Map([...ownedThreads(threads, automations, seeds, runThreads), ...[...adopted].filter(([id]) => !chains.has(id))]);
    // Runs' threads, for the automations a Bot owns (found as ownership grows).
    const runThreads = new Map<string, string>();
    let owners = own();
    const loaded = new Set<string>();
    for (let grew = true; grew;) {
      grew = false;
      const known = new Set([...chains.keys(), ...owners.keys()]);
      for (const automation of automations) {
        if (loaded.has(automation.id) || automation.execution.targetThreadId || !automation.createdByThreadId || !known.has(automation.createdByThreadId)) continue;
        loaded.add(automation.id);
        for (const threadId of await this.runThreads(automation)) runThreads.set(threadId, automation.id);
        grew = true;
      }
      if (grew) owners = own(runThreads);
    }
    this.owners = owners;
    const recorded = this.recorded();
    let hid = 0;
    for (const thread of threads) {
      const chained = chains.get(thread.id);
      const bot = chained ?? owners.get(thread.id);
      if (!bot || !this.eligible(thread, recorded)) continue;
      if (await this.hide(thread.id, bot, chained ? "chain" : thread.parentThreadId || thread.lifecycleOwnerThreadId ? "spawned" : "automation")) hid++;
    }
    if (hid) this.deps.changed?.();
    return hid;
  }

  /** Every unarchived thread, hidden ones included (a hidden thread can still own visible ones). */
  private async threads(): Promise<Listed[]> {
    const all: Listed[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const batch = await this.deps.sdk.threads.list({ archived: false, includeHidden: true, limit: PAGE, offset: page * PAGE });
      all.push(...batch);
      if (batch.length < PAGE) break;
    }
    return all;
  }

  private call(method: string, input: unknown) {
    return this.deps.sdk.plugins.callRpc({ pluginId: "automations", method, input: input as never, outputSchema: z.unknown() });
  }

  private async automations(): Promise<AutomationEntry[]> {
    const parsed = overview.safeParse(await this.call("automations_overview", null).catch(() => null));
    if (!parsed.success) return [];
    return parsed.data.automations.flatMap((entry) => {
      const automation = automationEntry.safeParse(entry.automation);
      return automation.success ? [{ ...automation.data, projectId: automation.data.projectId ?? entry.project.id }] : [];
    });
  }

  private async runThreads(automation: AutomationEntry): Promise<string[]> {
    const ids: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const parsed = runs.safeParse(await this.call("automations_runs", { projectId: automation.projectId, automationId: automation.id, limit: 200, ...(cursor ? { cursor } : {}) }).catch(() => null));
      if (!parsed.success) break;
      for (const run of parsed.data.runs) if (run.threadId) ids.push(run.threadId);
      cursor = parsed.data.nextCursor ?? undefined;
      if (!cursor) break;
    }
    return ids;
  }
}
