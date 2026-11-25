// The catch-up handoff for a thread moved to another provider (PLAN.md §P2).
//
// A move clears the provider session, so the first turn on the new provider
// starts with nothing. BB still has every turn in its event log; this builds
// from that log:
//  - a transcript file of every turn (secrets scrubbed, mode 0600) in the
//    thread's storage, for the agent to grep;
//  - the handoff text: a header (moved from X to Y, the transcript path), a
//    one-line outline of the older turns, and the newest turns word for word
//    up to the history budget (tokens ≈ chars / 4).
//
// The event log is read a page at a time and the transcript written as it
// goes, so a 10 MB history never sits in memory: only the verbatim tail
// (bounded by the budget) and one short outline line per older turn do.
//
// W3's move command calls `prepare` at move time; the turn-context hook then
// only reads the stored file. Without one, the hook builds it lazily within
// its time budget, and falls back to the header and transcript path. The
// stored handoff is kept until a turn starts on the new provider (the hook is
// called without `providerMove`), so a failed dispatch doesn't lose it.
import { closeSync, mkdirSync, openSync, renameSync, writeSync, chmodSync, statSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { isPingRequest } from "../bot-cache";
import { scrubber, type Scrub } from "../strands/scrub";

export const HANDOFF_KV_PREFIX = "studio.moveProvider.handoff.";
export const DEFAULT_HISTORY_TOKENS = 150_000;
/** The most the core hook takes for a move turn (shared interface: up to ~1.2M chars). */
export const HANDOFF_MAX_CHARS = 1_200_000;
const CHARS_PER_TOKEN = 4;
const PAGE = 100;
/** Pages read at most for one build (500k events). */
const MAX_PAGES = 5_000;
/** A whole build stops reading after this; what was read is still used, marked partial. */
const BUILD_MS = 60_000;
/** The hook waits this long for a lazy build before it falls back to the header. */
export const LAZY_BUILD_MS = 3_500;
/** The outline keeps this many characters; the middle goes first. */
const OUTLINE_MAX_CHARS = 60_000;
const OUTLINE_LINE = 160;
/** Event types the handoff reads. */
export const HANDOFF_EVENT_TYPES = ["client/turn/requested", "item/completed", "thread/compacted", "system/operation"] as const;
export const MOVE_OPERATION = "thread/provider-move";
const TURN_CONTEXT_LEAD = /^Context from the [^\n]* plugin at the start of this turn:/;

export interface MoveSide { providerId: string; model?: string | null }
export interface MoveTarget extends MoveSide { permissionMode?: string | null }
/** What the core turn-context hook passes while the first turn after a move hasn't started. */
export interface ProviderMoveInput { from: MoveSide; to: MoveTarget; historyTokens?: number; at?: number | string }

export type EventRow = { seq?: number; type?: string; createdAt?: number; data?: unknown };

export interface HandoffStats { transcriptPath: string; handoffPath: string; verbatimTurns: number; outlinedTurns: number; bytes: number; chars: number; partial: boolean }
export interface StoredHandoff extends HandoffStats { threadId: string; from: MoveSide; to: MoveTarget; historyTokens: number; builtAt: number }
export interface PrepareResult { ok: boolean; transcriptPath: string | null; verbatimTurns: number; outlinedTurns: number; bytes: number; error?: string }

export interface HandoffDeps {
  /** One page of the thread's events, oldest first, after `afterSeq`. */
  listEvents(query: { threadId: string; afterSeq: number; limit: number; types: readonly string[] }): Promise<EventRow[]>;
  /** The folder for this thread's transcript (created if missing). */
  dirFor(threadId: string): Promise<string>;
  /** Known secret values to scrub, as strands do. */
  secrets?(): Promise<readonly string[]> | readonly string[];
  kv: { get<T>(key: string): Promise<T | undefined>; set(key: string, value: unknown): Promise<void>; delete(key: string): Promise<void> };
  now?(): number;
  log?(message: string): void;
  /** Overrides for tests. */
  limits?: { buildMs?: number; lazyMs?: number; maxPages?: number };
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
const stamp = (ms: number | undefined) => (typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "unknown time");
const sideName = (side: MoveSide) => `${side.providerId}${side.model ? ` (${side.model})` : ""}`;
const json = (value: unknown, max: number) => { try { return clip(oneLine(typeof value === "string" ? value : JSON.stringify(value) ?? ""), max); } catch { return ""; } };

/** The budget for the verbatim turns, in characters. */
export function budgetChars(historyTokens: number | undefined): number {
  const tokens = typeof historyTokens === "number" && Number.isFinite(historyTokens) && historyTokens > 0 ? historyTokens : DEFAULT_HISTORY_TOKENS;
  return Math.min(Math.floor(tokens * CHARS_PER_TOKEN), HANDOFF_MAX_CHARS);
}

type Part = { type?: string; text?: string; url?: string; path?: string; visibility?: string };
type Item = {
  type?: string; text?: string; command?: string; aggregatedOutput?: string; exitCode?: number; server?: string; tool?: string;
  arguments?: unknown; result?: unknown; error?: string; changes?: { path?: string; kind?: unknown }[]; queries?: string[]; url?: string;
  path?: string; savedPath?: string; presentation?: { title?: string }; description?: string; parentToolCallId?: string;
};

/** Sizes for one rendering: compact for the handoff, roomy for the transcript. */
interface Sizes { args: number; result: number; note: number }
const COMPACT: Sizes = { args: 200, result: 300, note: 2_000 };
const ROOMY: Sizes = { args: 2_000, result: 4_000, note: 20_000 };

function image(part: Part): string {
  if (part.type === "localImage" || part.type === "localFile") return `[${part.type === "localFile" ? "file" : "image"}: ${part.path ?? "unknown path"}]`;
  if (part.url?.startsWith("data:")) return "[image: pasted inline, not kept]";
  return `[image: ${part.url ?? "unknown"}]`;
}

/** A request's opening: who wrote it and what it says, or null when it says nothing. */
function request(data: unknown, sizes: Sizes): { who: string; text: string } | null {
  const input = (data as { input?: Part[] } | null)?.input;
  if (!Array.isArray(input)) return null;
  const seen: string[] = [];
  const notes: string[] = [];
  for (const part of input) {
    if (part.type === "text" && typeof part.text === "string") {
      if (part.visibility === "agent-only") { if (!TURN_CONTEXT_LEAD.test(part.text)) notes.push(clip(part.text.trim(), sizes.note)); }
      else seen.push(part.text);
    } else if (part.type === "image" || part.type === "localImage" || part.type === "localFile") seen.push(image(part));
  }
  if (seen.some((text) => text.trim())) return { who: "user", text: [...seen, ...notes.map((note) => `[note to the agent] ${note}`)].join("\n").trim() };
  if (notes.length) return { who: "note", text: notes.join("\n").trim() };
  return null;
}

/** One completed item as plain text, or null for what isn't worth keeping (reasoning, plan steps). */
export function renderItem(item: Item | undefined, sizes: Sizes = COMPACT): string | null {
  if (!item?.type) return null;
  const sub = item.parentToolCallId ? "  " : "";
  const title = item.presentation?.title?.trim() || item.description?.trim();
  switch (item.type) {
    case "agentMessage": return item.text?.trim() ? `${sub}${item.text.trim()}` : null;
    case "userMessage": case "reasoning": case "planSteps": return null;
    case "commandExecution": {
      const out = item.aggregatedOutput?.trim() ? ` → ${clip(item.aggregatedOutput.trim(), sizes.result)}` : "";
      return `${sub}[tool] $ ${clip(oneLine(item.command ?? ""), sizes.args)}${typeof item.exitCode === "number" ? ` (exit ${item.exitCode})` : ""}${out}`;
    }
    case "toolCall": {
      const name = item.server ? `${item.server}.${item.tool}` : item.tool ?? "tool";
      const outcome = item.error ? ` → error: ${clip(oneLine(item.error), sizes.result)}` : item.result !== undefined ? ` → ${json(item.result, sizes.result)}` : "";
      return `${sub}[tool] ${name}(${item.arguments ? json(item.arguments, sizes.args) : ""})${outcome}`;
    }
    case "fileChange": return `${sub}[tool] edited ${(item.changes ?? []).map((change) => change.path).filter(Boolean).join(", ") || "files"}${item.error ? ` (error: ${clip(item.error, 200)})` : ""}`;
    case "webSearch": return `${sub}[tool] web search ${json(item.queries?.[0] ?? "", sizes.args)}`;
    case "webFetch": return `${sub}[tool] fetched ${item.url ?? ""}`;
    case "fileRead": return `${sub}[tool] read ${item.path ?? ""}`;
    case "search": return `${sub}[tool] searched ${item.path ?? ""}${title ? ` (${clip(title, 120)})` : ""}`;
    case "imageView": return `${sub}[image: ${item.path ?? "unknown path"}]`;
    case "imageGeneration": return `${sub}[image generated${item.savedPath || item.path ? `: ${item.savedPath ?? item.path}` : ""}]`;
    case "plan": return item.text?.trim() ? `${sub}[plan] ${clip(item.text.trim(), sizes.note)}` : null;
    case "contextCompaction": return "[context compacted here]";
    default: return title ? `${sub}[${item.type}] ${clip(oneLine(title), sizes.args)}` : null;
  }
}

interface OpenTurn { n: number; at: number | undefined; who: string; first: string; compact: string[]; roomy: string[] }
interface Tail { n: number; at: number | undefined; who: string; first: string; text: string }

const outlineLine = (turn: { n: number; at: number | undefined; who: string; first: string }) =>
  `- #${turn.n} ${stamp(turn.at)} · ${turn.who}: ${clip(turn.first, OUTLINE_LINE) || "(no text)"}`;

const turnHead = (turn: { n: number; at: number | undefined; who: string }) => `### Turn ${turn.n} · ${stamp(turn.at)} · ${turn.who}`;

/** Drops the middle of the outline to fit, keeping the start of the thread and the turns just before the verbatim ones. */
function fitOutline(lines: string[]): string[] {
  let size = lines.reduce((sum, line) => sum + line.length + 1, 0);
  if (size <= OUTLINE_MAX_CHARS) return lines;
  const head = lines.slice(0, 40);
  const rest = lines.slice(40);
  size = head.reduce((sum, line) => sum + line.length + 1, 0);
  const kept: string[] = [];
  for (let i = rest.length - 1; i >= 0 && size + rest[i]!.length + 1 <= OUTLINE_MAX_CHARS - 120; i--) { kept.unshift(rest[i]!); size += rest[i]!.length + 1; }
  return [...head, `- … ${rest.length - kept.length} turns left out here; they're in the transcript.`, ...kept];
}

export interface BuildInput { threadId: string; from: MoveSide; to: MoveTarget; historyTokens?: number; at?: number }

/** Reads the thread's events and writes the transcript and handoff files. */
export async function buildHandoff(deps: HandoffDeps, input: BuildInput): Promise<StoredHandoff> {
  const now = deps.now ?? Date.now;
  const started = now();
  const buildMs = deps.limits?.buildMs ?? BUILD_MS;
  const maxPages = deps.limits?.maxPages ?? MAX_PAGES;
  const budget = budgetChars(input.historyTokens);
  const scrub: Scrub = scrubber(await Promise.resolve(deps.secrets?.() ?? []).catch(() => [] as readonly string[]));
  const dir = await deps.dirFor(input.threadId);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const transcriptPath = join(dir, "transcript.md");
  const handoffPath = join(dir, "handoff.md");
  const partPath = `${transcriptPath}.part`;

  const fd = openSync(partPath, "w", 0o600);
  let bytes = 0;
  const write = (text: string) => { bytes += writeSync(fd, text); };
  const tail: Tail[] = [];
  let tailSize = 0;
  const outline: string[] = [];
  let turns = 0;
  let partial = false;
  let open: OpenTurn | null = null;

  const close = () => {
    if (!open) return;
    const turn = open;
    open = null;
    write(`${turnHead(turn)}\n\n${scrub(turn.roomy.join("\n\n"))}\n\n`);
    const text = scrub(`${turnHead(turn)}\n\n${turn.compact.join("\n\n")}`);
    tail.push({ n: turn.n, at: turn.at, who: turn.who, first: scrub(turn.first), text });
    tailSize += text.length + 2;
    while (tail.length > 1 && tailSize > budget) {
      const old = tail.shift()!;
      tailSize -= old.text.length + 2;
      outline.push(outlineLine(old));
    }
  };
  const begin = (at: number | undefined, who: string, text: string) => {
    close();
    turns += 1;
    open = { n: turns, at, who, first: oneLine(text.split("\n").find((line) => line.trim()) ?? ""), compact: text ? [text] : [], roomy: text ? [text] : [] };
  };
  const add = (at: number | undefined, compact: string | null, roomy: string | null) => {
    if (!compact && !roomy) return;
    if (!open) begin(at, "agent", "");
    const turn = open!;
    if (compact) turn.compact.push(compact);
    if (roomy) turn.roomy.push(roomy);
    if (!turn.first && compact) turn.first = oneLine(compact.split("\n").find((line) => line.trim()) ?? "");
  };

  try {
    write(`# Transcript of ${input.threadId}\n\nEvery turn from BB's event log, oldest first. Secrets are removed. Tool calls are shown as text.\n\n`);
    let after = 0;
    for (let page = 0; ; page++) {
      if (page >= maxPages || now() - started > buildMs) { partial = true; break; }
      const rows = await deps.listEvents({ threadId: input.threadId, afterSeq: after, limit: PAGE, types: HANDOFF_EVENT_TYPES });
      let last = after;
      for (const row of rows) {
        const seq = row.seq ?? 0;
        if (seq <= after) continue;
        last = Math.max(last, seq);
        const data = row.data as Record<string, unknown> | undefined;
        if (row.type === "client/turn/requested") {
          if (isPingRequest(data)) { begin(row.createdAt, "Studio ping", ""); continue; }
          const compact = request(data, COMPACT);
          if (!compact) continue;
          begin(row.createdAt, compact.who, compact.text);
          (open as OpenTurn | null)!.roomy = [request(data, ROOMY)?.text ?? compact.text];
        } else if (row.type === "item/completed") {
          const item = (data as { item?: Item } | undefined)?.item;
          add(row.createdAt, renderItem(item, COMPACT), renderItem(item, ROOMY));
        } else if (row.type === "thread/compacted") {
          add(row.createdAt, "[context compacted here]", "[context compacted here]");
        } else if (row.type === "system/operation" && data?.operation === MOVE_OPERATION) {
          const meta = (data.metadata ?? data) as { from?: MoveSide; to?: MoveSide };
          const line = `[moved from ${meta.from ? sideName(meta.from) : "?"} to ${meta.to ? sideName(meta.to) : "?"}]`;
          add(row.createdAt, line, line);
        }
      }
      if (rows.length < PAGE || last === after) break;
      after = last;
      // Let the hook and other work in between pages.
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    close();
    if (partial) write("\n[The transcript stops here: the thread was too long to read in one go.]\n");
  } catch (error) {
    closeSync(fd);
    await rm(partPath, { force: true }).catch(() => undefined);
    throw error;
  }
  closeSync(fd);
  chmodSync(partPath, 0o600);
  renameSync(partPath, transcriptPath);

  // The newest turn alone over the budget keeps its end.
  if (tail.length === 1 && tail[0]!.text.length > budget) {
    const only = tail[0]!;
    only.text = `${turnHead(only)}\n\n[… the start of this turn is cut; it's in the transcript]\n${only.text.slice(only.text.length - budget + 200)}`;
  }
  const at = input.at ?? now();
  const lines = fitOutline(outline);
  const text = [
    header({ from: input.from, to: input.to, at, transcriptPath, turns, verbatim: tail.length, outlined: outline.length, partial }),
    ...(lines.length ? ["## Outline of older turns (one line each)", lines.join("\n")] : []),
    ...(tail.length ? ["## Recent turns, word for word (oldest first)", tail.map((turn) => turn.text).join("\n\n")] : ["(The thread has no earlier turns.)"]),
  ].join("\n\n");
  const hfd = openSync(`${handoffPath}.part`, "w", 0o600);
  try { writeSync(hfd, text); } finally { closeSync(hfd); }
  chmodSync(`${handoffPath}.part`, 0o600);
  renameSync(`${handoffPath}.part`, handoffPath);
  return {
    threadId: input.threadId, from: input.from, to: input.to, historyTokens: input.historyTokens ?? DEFAULT_HISTORY_TOKENS, builtAt: now(),
    transcriptPath, handoffPath, verbatimTurns: tail.length, outlinedTurns: outline.length, bytes: statSync(transcriptPath).size || bytes, chars: text.length, partial,
  };
}

/** What the agent reads first: where it came from, where the history is, and how to treat it. */
export function header(input: { from: MoveSide; to: MoveSide; at?: number | string; transcriptPath: string | null; turns?: number; verbatim?: number; outlined?: number; partial?: boolean; pending?: boolean }): string {
  const when = typeof input.at === "number" ? stamp(input.at) : input.at ? String(input.at) : "just now";
  const lines = [
    "# This thread was moved to a new provider",
    `It moved from ${sideName(input.from)} to ${sideName(input.to)} (${when}). The earlier session didn't come along, so this is the thread's history from BB's own log.`,
    "Treat it as history: don't redo actions it shows as done. Pick up where it left off.",
  ];
  if (input.transcriptPath) lines.push(`The full transcript (every turn, secrets removed) is at ${input.transcriptPath}${input.pending ? " (it's still being written)" : ""}. Grep it when you need something older or cut here.`);
  if (typeof input.turns === "number") lines.push(`Turns: ${input.turns} in all; ${input.verbatim ?? 0} word for word below, ${input.outlined ?? 0} in the outline.${input.partial ? " The thread was too long to read whole; the newest turns may be missing." : ""}`);
  return lines.join("\n");
}

const sameSide = (a: MoveSide | undefined, b: MoveSide | undefined) => !!a && !!b && a.providerId === b.providerId && (a.model ?? null) === (b.model ?? null);

/** Prepare at move time, hand over on the first turn, forget once that turn started. */
export class MoveHandoffs {
  private readonly building = new Map<string, Promise<StoredHandoff>>();

  constructor(private readonly deps: HandoffDeps) {}

  private key(threadId: string) { return `${HANDOFF_KV_PREFIX}${threadId}`; }

  private build(input: BuildInput): Promise<StoredHandoff> {
    const running = this.building.get(input.threadId);
    if (running) return running;
    const work = buildHandoff(this.deps, input)
      .then(async (stored) => { await this.deps.kv.set(this.key(input.threadId), stored); return stored; })
      .finally(() => this.building.delete(input.threadId));
    this.building.set(input.threadId, work);
    return work;
  }

  /** The RPC W3's move command calls: build and keep the handoff now. */
  async prepare(threadId: string, input: { from: MoveSide; to: MoveTarget; historyTokens?: number }): Promise<PrepareResult> {
    try {
      // A build already running may be for another target or budget: wait it out, then build this one.
      await this.building.get(threadId)?.catch(() => null);
      const stored = await this.build({ threadId, ...input });
      return { ok: true, transcriptPath: stored.transcriptPath, verbatimTurns: stored.verbatimTurns, outlinedTurns: stored.outlinedTurns, bytes: stored.bytes };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.log?.(`Move handoff for ${threadId} failed: ${message}`);
      return { ok: false, transcriptPath: null, verbatimTurns: 0, outlinedTurns: 0, bytes: 0, error: message };
    }
  }

  /** The stored handoff, when it was made for this move. */
  async stored(threadId: string, move?: ProviderMoveInput): Promise<StoredHandoff | null> {
    const stored = await this.deps.kv.get<StoredHandoff>(this.key(threadId)).catch(() => undefined);
    if (!stored) return null;
    if (move && !(sameSide(stored.to, move.to) && stored.from?.providerId === move.from.providerId && (move.historyTokens === undefined || stored.historyTokens === move.historyTokens))) return null;
    return stored;
  }

  /** The text for the first turn after a move. Never throws; never deletes. */
  async forTurn(threadId: string, move: ProviderMoveInput): Promise<string | null> {
    const at = typeof move.at === "string" ? Date.parse(move.at) || undefined : move.at;
    try {
      const stored = await this.stored(threadId, move);
      if (stored) {
        const text = await readFile(stored.handoffPath, "utf8").catch(() => null);
        if (text) return text;
      }
      const lazyMs = this.deps.limits?.lazyMs ?? LAZY_BUILD_MS;
      const work = this.build({ threadId, from: move.from, to: move.to, historyTokens: move.historyTokens, at });
      work.catch((error) => this.deps.log?.(`Move handoff for ${threadId} failed: ${error instanceof Error ? error.message : String(error)}`));
      const built = await Promise.race([work.catch(() => null), new Promise<null>((resolve) => { setTimeout(() => resolve(null), lazyMs); })]);
      if (built) {
        const text = await readFile(built.handoffPath, "utf8").catch(() => null);
        if (text) return text;
      }
      const dir = await this.deps.dirFor(threadId).catch(() => null);
      return header({ from: move.from, to: move.to, at: at ?? move.at, transcriptPath: dir ? join(dir, "transcript.md") : null, pending: true });
    } catch (error) {
      this.deps.log?.(`Move handoff for ${threadId}: ${error instanceof Error ? error.message : String(error)}`);
      return header({ from: move.from, to: move.to, at: move.at, transcriptPath: null });
    }
  }

  /** A turn started on the new provider (the hook came without `providerMove`): the handoff is delivered. The transcript stays. */
  async settled(threadId: string): Promise<void> {
    if (this.building.has(threadId)) return;
    const stored = await this.deps.kv.get<StoredHandoff>(this.key(threadId)).catch(() => undefined);
    if (!stored) return;
    await this.deps.kv.delete(this.key(threadId));
    await rm(stored.handoffPath, { force: true }).catch(() => undefined);
  }
}
