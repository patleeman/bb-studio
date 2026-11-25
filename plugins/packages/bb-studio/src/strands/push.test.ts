import { describe, expect, it, vi } from "vitest";
import type { OverviewConversation, StrandAsk, StrandView } from "./contract";
import { pushFor, StrandPushes, type StrandPushDeps, type StrandPushInput } from "./push";

const strand = (id: string, state: StrandView["state"], asks: StrandAsk[] = [], over: Partial<StrandView> = {}): StrandView => ({
  id, title: `Strand ${id}`, summary: null, named: true, state, detail: state === "needs-you" && !asks.length ? "Release worker needs you" : null, asks, workers: [],
  lastAt: 1, firstAt: 1, firstSeq: 1, latestSeq: 2, latestTurnId: "turn_1", messages: 2, unsure: 0, pinned: false, origin: "jev", taskId: null, parentId: null, trunk: false, ...over,
});
const ask = (threadId: string, kind: StrandAsk["kind"] = "question"): StrandAsk => ({ id: `ask_${threadId}`, kind, threadId, label: "Merge the PR?", details: [], turnId: "turn_1", decisions: [], seq: null });
const conversation = (threadId: string, strands: StrandView[]): OverviewConversation => ({ threadId, title: threadId === "thr_main" ? "Main" : "BB Studio", isMain: threadId === "thr_main", lastActiveAt: 1, strands });

function harness(over: Partial<StrandPushDeps> = {}) {
  let rows: OverviewConversation[] = [];
  let kept: string[] | null = null;
  const sent: StrandPushInput[] = [];
  const pushedBots: string[] = [];
  const deps: StrandPushDeps = {
    bots: () => [{ id: "bot_main", name: "Chief of Staff" }],
    overview: async () => ({ conversations: rows }),
    bbPushesAsks: async (threadId) => threadId === "thr_visible",
    startedByAnotherThread: async () => false,
    projectOf: async () => "proj_1",
    notify: async (input) => { sent.push(input); },
    load: async () => kept,
    save: async (ids) => { kept = ids; },
    defaultProjectId: "proj_personal",
    pushed: (botId) => pushedBots.push(botId),
    delayMs: 0,
    ...over,
  };
  const pushes = new StrandPushes(deps);
  return { pushes, sent, pushedBots, set: (next: OverviewConversation[]) => { rows = next; }, kept: () => kept };
}

describe("the needs-you push", () => {
  it("only learns what already needs the user on its first check, so an update never floods the phone", async () => {
    const h = harness();
    h.set([conversation("thr_main", [strand("s1", "needs-you", [ask("thr_main")])])]);
    await h.pushes.check();
    expect(h.sent).toEqual([]);
    expect(h.kept()).toEqual(["s1"]);
  });

  it("pushes once when a strand turns needs you, not again while it stays, and again after it stopped", async () => {
    const h = harness();
    h.set([conversation("thr_main", [strand("s1", "active")])]);
    await h.pushes.check();
    h.set([conversation("thr_main", [strand("s1", "needs-you", [ask("thr_main")])])]);
    await h.pushes.check();
    await h.pushes.check();
    expect(h.sent).toEqual([{ title: "Strand s1 · Main", body: "Merge the PR?", kind: "needs-you", threadId: "thr_main", conversationId: "thr_main", botId: "bot_main", projectId: "proj_1" }]);
    expect(h.pushedBots).toEqual(["bot_main"]);
    h.set([conversation("thr_main", [strand("s1", "running")])]);
    await h.pushes.check();
    expect(h.kept()).toEqual([]);
    h.set([conversation("thr_main", [strand("s1", "needs-you", [ask("thr_main")])])]);
    await h.pushes.check();
    expect(h.sent).toHaveLength(2);
  });

  it("pushes a worker that needs the user, and a Tool Gateway request, with the conversation as the thread", async () => {
    const h = harness();
    await h.pushes.check();
    h.set([conversation("thr_lead", [strand("s1", "needs-you"), strand("s2", "needs-you", [ask("thr_lead", "gateway")])])]);
    await h.pushes.check();
    expect(h.sent.map((push) => [push.body, push.threadId, push.conversationId])).toEqual([["Release worker needs you", "thr_lead", "thr_lead"], ["Merge the PR?", "thr_lead", "thr_lead"]]);
  });

  it("leaves an ask BB pushes itself, or a question in a turn another thread started, to that; a gateway request and an area's item always push", async () => {
    const decide = { bbPushesAsks: async (threadId: string) => threadId === "thr_visible", startedByAnotherThread: async (threadId: string) => threadId === "thr_main" };
    expect(await pushFor(strand("s1", "needs-you", [ask("thr_visible")]), { threadId: "thr_visible", title: "A" }, decide)).toBeNull();
    expect(await pushFor(strand("s1", "needs-you", [ask("thr_main")]), { threadId: "thr_main", title: "Main" }, decide)).toBeNull();
    expect(await pushFor(strand("s1", "needs-you", [ask("thr_main", "gateway")]), { threadId: "thr_main", title: "Main" }, decide)).toEqual({ body: "Merge the PR?", threadId: "thr_main" });
    // An area's item that needs the user arrives in a runner's report, which another thread started: it still pushes.
    expect(await pushFor(strand("s1", "needs-you", [ask("thr_main", "area")]), { threadId: "thr_main", title: "Main" }, decide)).toEqual({ body: "Merge the PR?", threadId: "thr_main" });
    expect(await pushFor(strand("s1", "needs-you", [ask("thr_worker")]), { threadId: "thr_main", title: "Main" }, decide)).toEqual({ body: "Merge the PR?", threadId: "thr_main" });
  });

  it("marks a strand it left to BB as seen, so it doesn't push it on a later check either", async () => {
    const h = harness();
    await h.pushes.check();
    h.set([conversation("thr_visible", [strand("s1", "needs-you", [ask("thr_visible")])])]);
    await h.pushes.check();
    h.set([conversation("thr_visible", [strand("s1", "needs-you", [ask("thr_worker")])])]);
    await h.pushes.check();
    expect(h.sent).toEqual([]);
  });

  it("keeps going when one push fails, and logs it", async () => {
    const log = vi.fn();
    let calls = 0;
    const h = harness({ notify: async () => { calls += 1; if (calls === 1) throw new Error("relay down"); }, log });
    await h.pushes.check();
    h.set([conversation("thr_main", [strand("s1", "needs-you"), strand("s2", "needs-you")])]);
    await h.pushes.check();
    expect(calls).toBe(2);
    expect(log).toHaveBeenCalledWith("Strands push for s1 failed: relay down");
  });

  it("checks soon after a poke, once for several pokes", async () => {
    vi.useFakeTimers();
    try {
      const overview = vi.fn(async () => ({ conversations: [] }));
      const h = harness({ overview, delayMs: 2_000 });
      h.pushes.poke(); h.pushes.poke(); h.pushes.poke();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(overview).toHaveBeenCalledTimes(1);
      h.pushes.dispose();
      h.pushes.poke();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(overview).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  it("keeps what it pushed for a conversation it didn't read this time, so one coming back into the window doesn't push again", async () => {
    let read = ["thr_main", "thr_studio"];
    let rows: OverviewConversation[] = [];
    const where: Record<string, string> = { s1: "thr_main", s2: "thr_studio" };
    const h = harness({ overview: async () => ({ conversations: rows.filter((row) => read.includes(row.threadId)), checked: read }), strandThread: (id) => where[id] ?? null });
    rows = [conversation("thr_main", [strand("s1", "active")]), conversation("thr_studio", [strand("s2", "active")])];
    await h.pushes.check();
    rows = [conversation("thr_main", [strand("s1", "needs-you", [ask("thr_main")])]), conversation("thr_studio", [strand("s2", "needs-you", [ask("thr_studio")])])];
    await h.pushes.check();
    expect(h.sent.map((push) => push.conversationId)).toEqual(["thr_main", "thr_studio"]);
    // BB Studio goes quiet for a day: the check stops reading it, and still knows s2 was pushed.
    read = ["thr_main"];
    await h.pushes.check();
    expect(h.kept()!.sort()).toEqual(["s1", "s2"]);
    // It comes back with s2 still needing the user: no second push.
    read = ["thr_main", "thr_studio"];
    await h.pushes.check();
    expect(h.sent).toHaveLength(2);
    // Read again and no longer needing the user: forgotten, so a later turn pushes again.
    rows = [conversation("thr_main", [strand("s1", "needs-you", [ask("thr_main")])]), conversation("thr_studio", [strand("s2", "active")])];
    await h.pushes.check();
    expect(h.kept()).toEqual(["s1"]);
  });

  it("stops run() without saving or notifying when disposed while overview() is in flight", async () => {
    let releaseOverview!: () => void;
    let calls = 0;
    const overview = vi.fn(async () => {
      calls += 1;
      if (calls === 1) await new Promise<void>((resolve) => { releaseOverview = resolve; });
      return { conversations: [conversation("thr_main", [strand("s1", "needs-you", [ask("thr_main")])])] };
    });
    const save = vi.fn(async () => {});
    const notify = vi.fn(async () => {});
    const pushed = vi.fn();
    const h = harness({
      bots: () => [{ id: "bot_1", name: "One" }, { id: "bot_2", name: "Two" }],
      load: async () => [],
      overview,
      save,
      notify,
      pushed,
    });

    const checking = h.pushes.check();
    await new Promise((r) => setTimeout(r, 0));
    expect(overview).toHaveBeenCalledTimes(1);

    h.pushes.dispose();
    releaseOverview();
    await checking;

    expect(overview).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(pushed).not.toHaveBeenCalled();
  });

  it("finishes sending a saved push when disposed during pushFor() across a two-instance reload (exactly one notify)", async () => {
    let releaseAsk!: () => void;
    let kept: string[] | null = [];
    const rows = [conversation("thr_main", [strand("s1", "needs-you", [ask("thr_main")])])];
    const notify = vi.fn(async () => {});
    const shared = {
      bots: () => [{ id: "bot_main", name: "Chief of Staff" }],
      overview: async () => ({ conversations: rows }),
      startedByAnotherThread: async () => false,
      projectOf: async () => "proj_1",
      notify,
      load: async () => kept,
      save: async (ids: string[]) => { kept = ids; },
      defaultProjectId: "proj_personal",
      delayMs: 0,
    };
    const first = new StrandPushes({
      ...shared,
      bbPushesAsks: async () => {
        await new Promise<void>((resolve) => { releaseAsk = resolve; });
        return false;
      },
    });
    const second = new StrandPushes({
      ...shared,
      bbPushesAsks: async () => false,
    });

    const firstCheck = first.check();
    await new Promise((r) => setTimeout(r, 0));

    // Reload: first instance is disposed after save() already recorded s1, and the new instance runs.
    first.dispose();
    await second.check();
    releaseAsk();
    await firstCheck;

    expect(kept).toEqual(["s1"]);
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
