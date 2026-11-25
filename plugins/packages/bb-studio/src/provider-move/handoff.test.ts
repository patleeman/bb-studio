import { mkdtempSync, readFileSync, rmSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { budgetChars, buildHandoff, DEFAULT_HISTORY_TOKENS, HANDOFF_KV_PREFIX, MoveHandoffs, renderItem, type EventRow, type HandoffDeps } from "./handoff";
import { registerTurnContext, turnText } from "../live-activity";

const FROM = { providerId: "claude-code", model: "claude-opus-5-5" };
const TO = { providerId: "acp-antigravity-acp", model: "gemini-4-neon", permissionMode: "accept-edits" };
const KNOWN_SECRET = "studio-known-secret-value-0001";
const TOKEN = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "mp-handoff-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

/** A synthetic history: `turns` turns, each a user message, a tool call, a command and a reply. */
function history(turns: number, opts: { replyChars?: number } = {}): EventRow[] {
  const rows: EventRow[] = [];
  let seq = 0;
  const at = (n: number) => Date.UTC(2026, 10, 1) + n * 60_000;
  for (let n = 1; n <= turns; n++) {
    const extra = n === 3 ? ` codeword ZEBRA-41 and my token ${TOKEN} and key ${KNOWN_SECRET}` : "";
    rows.push({ seq: ++seq, type: "client/turn/requested", createdAt: at(n), data: { input: [
      { type: "text", text: `Question ${n}: please look at item ${n}.${extra}` },
      ...(n === 5 ? [{ type: "localImage", path: "/tmp/shots/five.png" }, { type: "image", url: "data:image/png;base64,AAAA" }] : []),
      { type: "text", text: "Context from the studio plugin at the start of this turn:\n\nElsewhere: digest", visibility: "agent-only" },
    ] } });
    rows.push({ seq: ++seq, type: "item/completed", createdAt: at(n), data: { item: { type: "reasoning", id: `r${n}`, summary: ["thinking"], content: [] } } });
    rows.push({ seq: ++seq, type: "item/completed", createdAt: at(n), data: { item: { type: "toolCall", id: `t${n}`, server: "bb-bridge", tool: "memory", arguments: { op: "search", q: `item ${n}` }, status: "completed", result: { hits: n } } } });
    rows.push({ seq: ++seq, type: "item/completed", createdAt: at(n), data: { item: { type: "commandExecution", id: `c${n}`, command: `ls item-${n}`, cwd: "/w", status: "completed", approvalStatus: null, aggregatedOutput: `file-${n}.txt`, exitCode: 0 } } });
    rows.push({ seq: ++seq, type: "item/completed", createdAt: at(n), data: { item: { type: "agentMessage", id: `a${n}`, text: `Answer ${n}. ${"x".repeat(opts.replyChars ?? 200)}` } } });
    if (n === 7) rows.push({ seq: ++seq, type: "thread/compacted", createdAt: at(n), data: {} });
  }
  rows.push({ seq: ++seq, type: "system/operation", createdAt: at(turns + 1), data: { operation: "thread/provider-move", metadata: { from: FROM, to: TO, historyTokens: 150_000 } } });
  return rows;
}

function deps(rows: EventRow[], extra: Partial<HandoffDeps> = {}) {
  const kv = new Map<string, unknown>();
  const listEvents = vi.fn(async ({ afterSeq, limit }: { afterSeq: number; limit: number }) => rows.filter((row) => (row.seq ?? 0) > afterSeq).slice(0, limit));
  const d: HandoffDeps = {
    listEvents,
    dirFor: async (threadId) => join(root, threadId),
    secrets: () => [KNOWN_SECRET],
    kv: { get: async <T,>(key: string) => kv.get(key) as T | undefined, set: async (key, value) => { kv.set(key, value); }, delete: async (key) => { kv.delete(key); } },
    ...extra,
  };
  return { d, kv, listEvents };
}

it("renders tool calls as plain text and leaves reasoning out", () => {
  expect(renderItem({ type: "toolCall", server: "s", tool: "t", arguments: { a: 1 }, result: "ok" } as never)).toBe('[tool] s.t({"a":1}) → ok');
  expect(renderItem({ type: "commandExecution", command: "ls", exitCode: 2, aggregatedOutput: "nope" } as never)).toBe("[tool] $ ls (exit 2) → nope");
  expect(renderItem({ type: "imageView", path: "/a.png" } as never)).toBe("[image: /a.png]");
  expect(renderItem({ type: "reasoning" } as never)).toBeNull();
  expect(renderItem({ type: "toolCall", tool: "t", arguments: { big: "y".repeat(5_000) } } as never)!.length).toBeLessThan(260);
});

it("long history: newest turns verbatim within the budget, older ones outlined, transcript has everything scrubbed and is 0600", async () => {
  const rows = history(400, { replyChars: 2_000 });
  const { d } = deps(rows);
  const tokens = 20_000; // 80k chars: about 30 turns of ~2.5k chars
  const built = await buildHandoff(d, { threadId: "thr_long", from: FROM, to: TO, historyTokens: tokens, at: Date.UTC(2026, 10, 25) });
  expect(built.verbatimTurns + built.outlinedTurns).toBe(400);
  expect(built.verbatimTurns).toBeGreaterThan(10);
  expect(built.outlinedTurns).toBeGreaterThan(300);

  const text = readFileSync(built.handoffPath, "utf8");
  const verbatim = text.slice(text.indexOf("## Recent turns"));
  expect(verbatim.length).toBeLessThanOrEqual(budgetChars(tokens) + 100);
  expect(verbatim).toContain("### Turn 400 ");
  expect(verbatim).toContain("Question 400: please look at item 400.");
  expect(verbatim).toContain('[tool] bb-bridge.memory({"op":"search","q":"item 400"}) → {"hits":400}');
  expect(verbatim).toContain("[tool] $ ls item-400 (exit 0) → file-400.txt");
  expect(verbatim).not.toContain("Question 1:");
  expect(text).toMatch(/^# This thread was moved to a new provider\nIt moved from claude-code \(claude-opus-5-5\) to acp-antigravity-acp \(gemini-4-neon\)/);
  expect(text).toContain(`The full transcript (every turn, secrets removed) is at ${built.transcriptPath}`);
  expect(text).toContain("## Outline of older turns");
  expect(text).toMatch(/- #1 2026-11-01 00:01 UTC · user: Question 1: please look at item 1\./);
  expect(text).not.toContain("Elsewhere: digest");

  const transcript = readFileSync(built.transcriptPath, "utf8");
  for (const n of [1, 3, 200, 400]) expect(transcript).toContain(`Question ${n}: please look at item ${n}.`);
  expect(transcript).toContain("codeword ZEBRA-41");
  expect(transcript).toContain("[context compacted here]");
  expect(transcript).toContain("[moved from claude-code (claude-opus-5-5) to acp-antigravity-acp (gemini-4-neon)]");
  for (const file of [transcript, text]) { expect(file).not.toContain(TOKEN); expect(file).not.toContain(KNOWN_SECRET); }
  expect(statSync(built.transcriptPath).mode & 0o777).toBe(0o600);
  expect(statSync(built.handoffPath).mode & 0o777).toBe(0o600);
  expect(existsSync(`${built.transcriptPath}.part`)).toBe(false);
  expect(built.bytes).toBe(statSync(built.transcriptPath).size);
});

it("images become paths, inline images are dropped", async () => {
  const { d } = deps(history(6));
  const built = await buildHandoff(d, { threadId: "thr_img", from: FROM, to: TO });
  const text = readFileSync(built.handoffPath, "utf8");
  expect(text).toContain("[image: /tmp/shots/five.png]");
  expect(text).toContain("[image: pasted inline, not kept]");
  expect(text).not.toContain("base64");
});

it("honors the budget flag: a bigger budget keeps more turns verbatim, and the default is 150k tokens", async () => {
  const rows = history(300, { replyChars: 1_000 });
  const small = await buildHandoff(deps(rows).d, { threadId: "a", from: FROM, to: TO, historyTokens: 5_000 });
  const large = await buildHandoff(deps(rows).d, { threadId: "b", from: FROM, to: TO, historyTokens: 60_000 });
  const fallback = await buildHandoff(deps(rows).d, { threadId: "c", from: FROM, to: TO });
  expect(small.verbatimTurns).toBeLessThan(large.verbatimTurns);
  expect(large.verbatimTurns).toBeLessThan(fallback.verbatimTurns);
  expect(fallback.verbatimTurns).toBe(300); // ~400k chars fits in 600k
  expect(fallback.historyTokens).toBe(DEFAULT_HISTORY_TOKENS);
  expect(budgetChars(10_000_000)).toBe(1_200_000);
});

it("a newest turn larger than the budget keeps its end", async () => {
  const { d } = deps(history(2, { replyChars: 50_000 }));
  const built = await buildHandoff(d, { threadId: "big", from: FROM, to: TO, historyTokens: 2_000 });
  const text = readFileSync(built.handoffPath, "utf8");
  expect(built.verbatimTurns).toBe(1);
  expect(text).toContain("[… the start of this turn is cut; it's in the transcript]");
  expect(text.length).toBeLessThan(12_000);
});

it("~10 MB of events: pages through, writes the transcript, under 3 s", async () => {
  const rows = history(2_000, { replyChars: 4_500 });
  const { d, listEvents } = deps(rows);
  const started = Date.now();
  const built = await buildHandoff(d, { threadId: "huge", from: FROM, to: TO });
  expect(Date.now() - started).toBeLessThan(3_000);
  expect(built.bytes).toBeGreaterThan(9_000_000);
  expect(listEvents.mock.calls.length).toBeGreaterThan(100);
  expect(listEvents.mock.calls.every(([query]) => query.limit === 100)).toBe(true);
  expect(readFileSync(built.handoffPath, "utf8").length).toBeLessThan(budgetChars(DEFAULT_HISTORY_TOKENS) + 70_000);
});

it("a cap on pages marks the build partial instead of reading forever", async () => {
  const { d } = deps(history(100), { limits: { maxPages: 2 } });
  const built = await buildHandoff(d, { threadId: "cap", from: FROM, to: TO });
  expect(built.partial).toBe(true);
  expect(readFileSync(built.transcriptPath, "utf8")).toContain("The transcript stops here");
});

it("prepare stores the handoff; it survives hook calls with the move (failed dispatch) and goes once a turn started", async () => {
  const { d, kv } = deps(history(20));
  const moves = new MoveHandoffs(d);
  const result = await moves.prepare("thr_x", { from: FROM, to: TO, historyTokens: 150_000 });
  expect(result).toMatchObject({ ok: true, verbatimTurns: 20, outlinedTurns: 0 });
  expect(result.bytes).toBeGreaterThan(0);
  const stored = kv.get(`${HANDOFF_KV_PREFIX}thr_x`) as { handoffPath: string; transcriptPath: string };
  const move = { from: FROM, to: TO, historyTokens: 150_000, at: Date.UTC(2026, 10, 25) };
  const first = await moves.forTurn("thr_x", move);
  const again = await moves.forTurn("thr_x", move); // the first dispatch failed; BB asks again
  expect(first).toContain("Question 20: please look at item 20.");
  expect(again).toBe(first);
  expect(kv.has(`${HANDOFF_KV_PREFIX}thr_x`)).toBe(true);
  await moves.settled("thr_x"); // a turn started: the hook came without providerMove
  expect(kv.has(`${HANDOFF_KV_PREFIX}thr_x`)).toBe(false);
  expect(existsSync(stored.handoffPath)).toBe(false);
  expect(existsSync(stored.transcriptPath)).toBe(true);
});

it("without a prepared handoff the hook builds it lazily; past its time it gives the header and transcript path", async () => {
  const quick = new MoveHandoffs(deps(history(5)).d);
  expect(await quick.forTurn("thr_q", { from: FROM, to: TO })).toContain("Question 5:");

  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const slow = deps(history(5), { limits: { lazyMs: 20 } });
  const listEvents = slow.d.listEvents;
  slow.d.listEvents = async (query) => { await gate; return listEvents(query); };
  const moves = new MoveHandoffs(slow.d);
  const text = await moves.forTurn("thr_s", { from: FROM, to: TO, historyTokens: 150_000 });
  expect(text).toContain("# This thread was moved to a new provider");
  expect(text).toContain(join(root, "thr_s", "transcript.md"));
  expect(text).toContain("still being written");
  release();
  await vi.waitFor(() => expect(slow.kv.has(`${HANDOFF_KV_PREFIX}thr_s`)).toBe(true));
  expect(await moves.forTurn("thr_s", { from: FROM, to: TO, historyTokens: 150_000 })).toContain("Question 5:");
});

it("a handoff prepared for another target isn't used", async () => {
  const { d } = deps(history(3));
  const moves = new MoveHandoffs(d);
  await moves.prepare("thr_t", { from: FROM, to: { providerId: "codex", model: "gpt" } });
  expect(await moves.stored("thr_t", { from: FROM, to: TO })).toBeNull();
  expect(await moves.stored("thr_t", { from: FROM, to: { providerId: "codex", model: "gpt" } })).not.toBeNull();
});

it("a failed build reports ok:false instead of throwing", async () => {
  const moves = new MoveHandoffs(deps([], { listEvents: async () => { throw new Error("server gone"); } }).d);
  expect(await moves.prepare("thr_f", { from: FROM, to: TO })).toMatchObject({ ok: false, error: "server gone", transcriptPath: null });
});

it("the turn-context hook puts the handoff ahead of the digest on a move turn, and settles otherwise", async () => {
  const moves = { forTurn: vi.fn(async () => "HANDOFF"), settled: vi.fn(async () => undefined) };
  const hooks = { experimental_turnContext: vi.fn() };
  expect(registerTurnContext({ experimental_hooks: hooks }, (threadId, context) => turnText(threadId, context, () => "DIGEST", moves))).toBe(true);
  const provider = hooks.experimental_turnContext.mock.calls[0]![0] as (context: object) => unknown;
  expect(await provider({ threadId: "t", providerMove: { from: FROM, to: TO, historyTokens: 1 } })).toBe("HANDOFF\n\nDIGEST");
  expect(moves.settled).not.toHaveBeenCalled();
  expect(provider({ threadId: "t" })).toBe("DIGEST");
  expect(moves.settled).toHaveBeenCalledWith("t");
});
