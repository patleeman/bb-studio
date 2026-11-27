// A fake conversation for strands' tests: BB-shaped events with paging, a
// Jev that sorts by topic word, and a small model that names, sorts and
// proposes by the same words. Deterministic; no BB, no network.
import Database from "better-sqlite3";
import { MIGRATIONS } from "../../migrations";
import { ensureColumns } from "../../schema-columns";
import type { DetectorDeps } from "../detector";
import type { EventRow } from "../turns";

/** Topic words and the name a careful model would give each. */
export const TOPICS: Record<string, string> = {
  router: "Model router",
  furnace: "Furnace tune-up",
  dentist: "Dentist appointment",
  plugins: "bb-plugins PR #15",
  taxes: "Q4 taxes",
  backup: "Backup restore",
  garden: "Garden beds",
  laptop: "Laptop battery",
  passport: "Passport renewal",
  podcast: "Podcast edit",
  invoice: "Client invoices",
  roof: "Roof leak",
};
const WORDS = Object.keys(TOPICS);
export const topicOf = (text: string): string | null => WORDS.find((word) => text.toLowerCase().includes(word)) ?? null;

/** The fixture's turns happen at this time (plus their seq in ms) unless a test gives one; the tests' clocks sit here too. */
export const FIXTURE_AT = Date.parse("2026-11-20T12:00:00Z");

export function database(): Database.Database {
  const db = new Database(":memory:");
  for (const sql of MIGRATIONS.filter(Boolean)) db.exec(sql);
  ensureColumns(db);
  return db;
}

export class FakeThread {
  readonly rows: EventRow[] = [];
  private seq = 0;
  private turns = 0;
  /** Event pages served, for counting reads. */
  pages = 0;

  constructor(readonly id = "thr_main") {}

  private push(row: Omit<EventRow, "seq">): number {
    this.seq++;
    this.rows.push({ ...row, seq: this.seq });
    return this.seq;
  }

  /** A turn: the request, the turn's start, `tools` tool items, the reply, and (when done) its end. */
  turn(text: string, reply: string, options: { at?: number; kind?: "user" | "report" | "ping"; done?: boolean; tools?: number; pingFirst?: boolean } = {}): { seq: number; turnId: string; requestSeq: number } {
    const at = options.at ?? FIXTURE_AT + this.seq;
    const turnId = `turn_${++this.turns}`;
    const kind = options.kind ?? "user";
    const input = kind === "ping" ? [{ type: "text", text: "[bb ping] keep warm", visibility: "agent-only" }]
      : kind === "report" ? [{ type: "text", text: "Runner report, already shown.", visibility: "agent-only" }, { type: "text", text }]
      : [{ type: "text", text }];
    // A keepalive queued ahead of the message: the turn starts with it.
    const ping = options.pingFirst ? this.push({ type: "client/turn/requested", createdAt: at, scope: { kind: "thread" }, data: { initiator: "system", input: [{ type: "text", text: "[bb ping] keep warm", visibility: "agent-only" }], target: { kind: "new-turn" } } }) : null;
    const requestSeq = this.push({ type: "client/turn/requested", createdAt: at, scope: { kind: "thread" }, data: { initiator: kind === "user" ? "user" : "system", input, target: { kind: "new-turn" } } });
    const seq = ping ?? requestSeq;
    this.push({ type: "turn/started", createdAt: at + 1, scope: { kind: "turn", turnId }, data: {} });
    for (let tool = 0; tool < (options.tools ?? 0); tool++) this.push({ type: "item/completed", createdAt: at + 2, scope: { kind: "turn", turnId }, data: { item: { type: "commandExecution", command: "ls" } } });
    if (reply) this.push({ type: "item/completed", createdAt: at + 3, scope: { kind: "turn", turnId }, data: { item: { type: "agentMessage", text: reply } } });
    if (options.done !== false) this.push({ type: "turn/completed", createdAt: at + 4, scope: { kind: "turn", turnId }, data: {} });
    return { seq, turnId, requestSeq };
  }

  /** A tool item in a running turn (a worker's spawn names it in its output). */
  tool(turnId: string, output: string, at = FIXTURE_AT + this.seq): number {
    return this.push({ type: "item/completed", createdAt: at, scope: { kind: "turn", turnId }, data: { item: { type: "commandExecution", command: "bb thread spawn", aggregatedOutput: output } } });
  }

  /** Ends the newest turn. */
  finish(turnId: string, reply = "Done.", at = FIXTURE_AT + this.seq): void {
    this.push({ type: "item/completed", createdAt: at, scope: { kind: "turn", turnId }, data: { item: { type: "agentMessage", text: reply } } });
    this.push({ type: "turn/completed", createdAt: at + 1, scope: { kind: "turn", turnId }, data: {} });
  }

  /** BB's events.list: after or before a seq, either order, a page at a time. Rows are in seq order, so pages are slices. */
  events = async (input: { threadId: string; afterSeq?: number; beforeSeq?: number; order: "asc" | "desc"; limit: number; types?: readonly string[] }): Promise<EventRow[]> => {
    this.pages++;
    if (input.threadId !== this.id) return [];
    if (input.types) {
      const rows = this.rows.filter((row) => input.types!.includes(row.type ?? "") && (row.seq ?? 0) > (input.afterSeq ?? 0) && (row.seq ?? 0) < (input.beforeSeq ?? Number.MAX_SAFE_INTEGER));
      return (input.order === "asc" ? rows : [...rows].reverse()).slice(0, input.limit);
    }
    // seq n sits at index n - 1.
    if (input.order === "asc") {
      const from = input.afterSeq ?? 0;
      return this.rows.slice(from, from + input.limit);
    }
    const before = Math.min(input.beforeSeq ?? this.seq + 1, this.seq + 1);
    const end = before - 1;
    return this.rows.slice(Math.max(0, end - input.limit), end).reverse();
  };
}

type Strandish = { id: string; title: string };

/** A Jev that picks the strand whose title names the message's topic, new for a new topic, none for thanks, and an unsure guess for "hmm". */
export function fakeJev(calls: { state: unknown; questions: Record<string, unknown> }[] = [], options: { down?: boolean } = {}): DetectorDeps["jev"] {
  const pick = (text: string, strands: Strandish[]) => {
    if (/^\s*(thanks|ok|great)\b/i.test(text)) return { choice: "none", confidence: 0.9 };
    if (/^\s*hmm\b/i.test(text)) return { choice: strands.length ? "s1" : "new", confidence: 0.3 };
    const topic = topicOf(text);
    const at = topic ? strands.findIndex((strand) => topicOf(strand.title) === topic || strand.title.toLowerCase().includes(topic) || strand.title === TOPICS[topic]) : -1;
    return at >= 0 ? { choice: strand(at), confidence: 0.9 } : { choice: "new", confidence: 0.8 };
  };
  const strand = (index: number) => `s${index + 1}`;
  return async (input) => {
    calls.push({ state: input.state, questions: input.questions });
    if (options.down) return { ok: false, unavailable: true, error: "No Jev provider" };
    const state = input.state as { message?: string; strands: Strandish[]; messages?: { id: string; message: string }[] };
    const answers: Record<string, unknown> = {};
    if (state.messages) for (const message of state.messages) answers[message.id] = { type: "choice", probabilities: {}, ...pick(message.message, state.strands) };
    else if (state.strands) answers.strand = { type: "choice", probabilities: {}, ...pick(state.message ?? "", state.strands) };
    // The reply questions (src/strands/reply.ts). This stand-in for Jev decides by words; the real one reads the reply.
    const asks = /\?|\bdecide\b|\bsign in\b|\bon your phone\b/i;
    if (input.questions.reply) {
      const end = (input.state as { replyEnd?: string }).replyEnd ?? "";
      answers.reply = asks.test(end) ? { type: "choice", probabilities: {}, choice: "needs-you", confidence: 0.85 } : { type: "choice", probabilities: {}, choice: "status", confidence: 0.9 };
    }
    if (input.questions.askSentence) {
      const sentences = Object.entries((input.state as { sentences?: Record<string, string> }).sentences ?? {});
      const found = [...sentences].reverse().find(([, sentence]) => asks.test(sentence));
      answers.askSentence = { type: "choice", probabilities: {}, choice: found?.[0] ?? "none", confidence: 0.8 };
    }
    // Clearing: a message answers an ask on its topic, or is a go-ahead for the newest ask; thanks answers none.
    const open = (input.state as { openAsks?: { id: string; ask: string; strand: string | null }[] }).openAsks ?? [];
    const message = (input.state as { message?: string }).message ?? "";
    open.forEach((ask, index) => {
      const topic = topicOf(message);
      const both = /\bboth\b/i.test(message);
      const goAhead = /^\s*(?:ok|okay|yes|sure|go ahead|do it)\b/i.test(message) && !/^\s*(?:thanks|thank you)\b/i.test(message);
      const hit = (topic !== null && topic === topicOf(`${ask.ask} ${ask.strand ?? ""}`)) || (both && goAhead) || (goAhead && topic === null && index === open.length - 1);
      answers[`clear_${ask.id}`] = { type: "choice", probabilities: {}, choice: hit ? "answers" : "other", confidence: 0.85 };
    });
    return { ok: true, answers };
  };
}

const block = (prompt: string, tag: string) => (new RegExp(`<${tag}>\\n([\\s\\S]*?)\\n</${tag}>`).exec(prompt)?.[1] ?? "").split("\n");

/** A small model that names by topic, folds a strand into an open one with the same topic, and sorts by topic. */
export function fakeModel(calls: string[] = [], options: { down?: boolean; badNames?: boolean } = {}): DetectorDeps["model"] {
  return async ({ prompt }) => {
    calls.push(prompt);
    if (options.down) return { ok: false, unavailable: true, error: "The fallback model is turned off." };
    if (prompt.includes("Propose at most")) {
      const topics = [...new Set(block(prompt, "messages").map(topicOf).filter((each): each is string => !!each))];
      const tasks: Record<string, { title: string; summary: string }> = {};
      for (const line of block(prompt, "tasks")) { const m = /^(t\d+): (.*)$/.exec(line); if (m) tasks[m[1]!] = { title: m[2]!.replace(/^Worker: /, "").replace(/\s*\(.*\)$/, ""), summary: "An open task." }; }
      return { ok: true, text: JSON.stringify({ strands: topics.slice(0, 12).map((topic) => ({ title: TOPICS[topic], summary: `Work on the ${topic}.` })), tasks }) };
    }
    if (prompt.includes("You name the strands")) {
      const open = block(prompt, "open").map((line) => /^(s\d+): (.*?)(?: \(|$)/.exec(line)).filter(Boolean).map((m) => ({ key: m![1]!, title: m![2]! }));
      const answers: Record<string, unknown> = {};
      let key: string | null = null;
      for (const line of block(prompt, "new")) {
        const head = /^(n\d+):$/.exec(line);
        if (head) { key = head[1]!; continue; }
        if (!key || answers[key]) continue;
        const topic = topicOf(line);
        const same = topic ? open.find((strand) => strand.title === TOPICS[topic]) : undefined;
        answers[key] = options.badNames ? { title: "Follow-up questions" } : same ? { same: same.key } : { title: topic ? TOPICS[topic] : "Odd jobs", summary: "Named by the fake model." };
      }
      for (const line of block(prompt, "refresh")) { const m = /^(r\d+): /.exec(line); if (m) answers[m[1]!] = { summary: "Refreshed." }; }
      return { ok: true, text: `Here you go:\n${JSON.stringify(answers)}` };
    }
    if (prompt.includes("Sort each message")) {
      const strands = block(prompt, "strands").map((line) => /^(s\d+): (.*?)(?: \(|$)/.exec(line)).filter(Boolean).map((m) => ({ key: m![1]!, title: m![2]! }));
      const answers: Record<string, string> = {};
      for (const line of block(prompt, "messages")) {
        const m = /^(m\d+): (.*)$/.exec(line);
        if (!m) continue;
        const topic = topicOf(m[2]!);
        const found = topic ? strands.find((strand) => strand.title.toLowerCase().includes(topic) || strand.title === TOPICS[topic]) : undefined;
        answers[m[1]!] = /^(thanks|ok)\b/i.test(m[2]!) ? "none" : found ? found.key : "new";
      }
      return { ok: true, text: JSON.stringify(answers) };
    }
    return { ok: true, text: null };
  };
}

/** Timers the test runs by hand. */
export function manualTimers() {
  const due: { run: () => void; ms: number }[] = [];
  return {
    setTimer: (run: () => void, ms: number) => { const timer = { run, ms }; due.push(timer); return timer; },
    clearTimer: (handle: unknown) => { const at = due.indexOf(handle as never); if (at >= 0) due.splice(at, 1); },
    /** Runs every timer set so far (and any they set), in order. */
    runAll: async (settle: () => Promise<void>) => {
      for (let guard = 0; due.length && guard < 50; guard++) { const next = due.shift()!; next.run(); await settle(); }
    },
    pending: () => due.length,
  };
}
