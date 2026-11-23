// The failure paths the review asked for: a turn that never ends, Jev
// errors and timeouts, the summary refresh, the small model's daily cap,
// backfill once, non-Main threads, and secrets kept out of what is sent.
import { afterEach, describe, expect, it, vi } from "vitest";
import { strandsThreadFor } from "./cli";
import { JEV_BACKOFF_MS, JEV_DAILY_CAP, JEV_TIMEOUT_MS, MODEL_DAILY_CAP, StrandDetector, type DetectorDeps } from "./detector";
import { REDACTED, scrubber } from "./scrub";
import { StrandService } from "./service";
import { StrandStore } from "./store";
import { database, FakeThread, fakeJev, fakeModel, manualTimers } from "./test/fixture";

const DAY = "2026-11-20";
const START = Date.parse(`${DAY}T12:00:00Z`);
const MIN = 60_000;

function setup(options: { jev?: DetectorDeps["jev"]; model?: DetectorDeps["model"]; secrets?: string[]; completeText?: DetectorDeps["completeText"] } = {}) {
  const clock = { now: START };
  const db = database();
  const store = new StrandStore(db, () => clock.now);
  const thread = new FakeThread();
  const jevCalls: { state: unknown; questions: Record<string, unknown> }[] = [];
  const modelCalls: string[] = [];
  const logs: string[] = [];
  const timers = manualTimers();
  const detector = new StrandDetector({
    store, events: thread.events, jev: options.jev ?? fakeJev(jevCalls), model: options.model ?? fakeModel(modelCalls),
    openTasks: () => [], changed: () => {}, log: (line) => logs.push(line), now: () => clock.now,
    setTimer: timers.setTimer, clearTimer: timers.clearTimer, secrets: () => options.secrets ?? [],
    ...(options.completeText ? { completeText: options.completeText } : {}),
  });
  const run = () => timers.runAll(() => detector.settled(thread.id));
  return { db, store, thread, detector, jevCalls, modelCalls, logs, clock, run };
}

afterEach(() => { vi.useRealTimers(); });

describe("a turn that never gets its turn/completed", () => {
  it("doesn't hold the read: the next turn's start ends it, and a long read moves on page by page", async () => {
    const x = setup();
    await x.detector.backfill(x.thread.id);
    const lost = x.thread.turn("Look at the router", "Looking…", { done: false });
    for (let index = 0; index < 70; index++) x.thread.turn(`Disk note ${index}`, "Ok.", { tools: 100 });
    const pages = x.thread.pages;
    await x.detector.idle(x.thread.id);
    // Wait for the reads it queued itself (each moved forward).
    for (let guard = 0; guard < 20 && x.store.read(x.thread.id)!.seenSeq < x.thread.rows.length; guard++) await x.detector.settled(x.thread.id);
    expect(x.store.read(x.thread.id)!.seenSeq).toBe(x.thread.rows.length);
    // Every event read about once: 70 turns × 104 events, 100 per page.
    expect(x.thread.pages - pages).toBeLessThan(90);
    expect(x.store.item(x.thread.id, "user", lost.seq)).toMatchObject({ by: "jev" });
    expect(x.store.items(x.thread.id, 1000)).toHaveLength(71);
  });

  it("is finished once BB says the thread is idle, or after 2 hours", async () => {
    const x = setup();
    await x.detector.backfill(x.thread.id);
    const last = x.thread.turn("Book the furnace service", "Asking…", { done: false });
    await x.detector.idle(x.thread.id);
    expect(x.store.item(x.thread.id, "user", last.seq)).toBeNull();
    expect(x.store.read(x.thread.id)!.seenSeq).toBe(last.seq - 1);
    await x.detector.idle(x.thread.id, true);
    expect(x.store.item(x.thread.id, "user", last.seq)).not.toBeNull();
    expect(x.store.read(x.thread.id)!.seenSeq).toBe(x.thread.rows.length);

    const y = setup();
    await y.detector.backfill(y.thread.id);
    const stale = y.thread.turn("Book the dentist", "Asking…", { done: false, at: START });
    y.clock.now = START + 3 * 60 * MIN;
    await y.detector.idle(y.thread.id);
    expect(y.store.item(y.thread.id, "user", stale.seq)).not.toBeNull();
  });

  it("never reads the same window twice when a full read can't move past it", async () => {
    const x = setup();
    await x.detector.backfill(x.thread.id);
    // A running turn followed by more than a read's worth of its own events.
    const running = x.thread.turn("Run the big migration", "", { done: false, tools: 7_000 });
    const pages = x.thread.pages;
    await x.detector.idle(x.thread.id);
    await x.detector.settled(x.thread.id);
    for (let guard = 0; guard < 5; guard++) await x.detector.settled(x.thread.id);
    // Each window read once: about one page per 100 events, never the first 60 pages again.
    expect(x.thread.pages - pages).toBeLessThanOrEqual(Math.ceil(x.thread.rows.length / 100) + 2);
    expect(x.store.read(x.thread.id)!.seenSeq).toBe(x.thread.rows.length);
    expect(running.seq).toBeLessThan(x.thread.rows.length);
    expect(x.logs.some((line) => line.includes("has no end"))).toBe(true);
  });
});

describe("Jev failing or slow", () => {
  it("backs off after errors in a row, sends turns to the previous strand meanwhile, and logs once per back-off", async () => {
    let fail = false;
    const calls: unknown[] = [];
    const good = fakeJev();
    const x = setup({ jev: async (input) => { calls.push(input); return fail ? { ok: false, unavailable: false, error: "provider error" } : good(input); } });
    await x.detector.backfill(x.thread.id);
    x.thread.turn("Look at the router", "Ok.");
    await x.detector.idle(x.thread.id);
    fail = true;
    for (let index = 0; index < 5; index++) x.thread.turn(`Disk note ${index}`, "Ok.");
    await x.detector.idle(x.thread.id);
    expect(calls).toHaveLength(3);
    expect(x.logs.filter((line) => line.includes("Jev failed"))).toHaveLength(1);
    const items = x.store.items(x.thread.id, 10);
    expect(items.filter((item) => item.by === "fallback")).toHaveLength(5);
    expect(x.store.pending(x.thread.id, 10)).toHaveLength(0);
    // After the back-off, Jev is asked again; a success clears it.
    fail = false;
    x.clock.now += JEV_BACKOFF_MS + 1;
    x.thread.turn("Book the dentist", "Ok.");
    await x.detector.idle(x.thread.id);
    expect(calls).toHaveLength(4);
    expect(x.store.read(x.thread.id)!.jevCalls).toBe(4);
  });

  it("gives Jev 15 seconds, then counts a timeout as a failure", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const x = setup({ jev: () => new Promise(() => {}) });
    await x.detector.backfill(x.thread.id);
    const turn = x.thread.turn("Look at the router", "Ok.");
    const sorting = x.detector.idle(x.thread.id);
    await vi.advanceTimersByTimeAsync(JEV_TIMEOUT_MS + 10);
    await sorting;
    expect(x.store.item(x.thread.id, "user", turn.seq)).toMatchObject({ by: "fallback" });
  });

  it("in the backfill, a Jev failure leaves the batch unsorted instead of asking the small model", async () => {
    const x = setup({ jev: async () => ({ ok: false, unavailable: false, error: "provider error" }) });
    for (let index = 0; index < 40; index++) x.thread.turn(`Router note ${index}`, "Ok.");
    const report = await x.detector.backfill(x.thread.id);
    expect(report).toMatchObject({ messages: 40, sorted: 0, unsorted: 40 });
    expect(x.modelCalls.filter((prompt) => prompt.includes("Sort each message"))).toHaveLength(0);
  });
});

describe("the small model", () => {
  it("refreshes a summary at most once a day, even when it gives none", async () => {
    const prompts: string[] = [];
    const naming = fakeModel();
    const x = setup({ model: async (input) => { prompts.push(input.prompt); return input.prompt.includes("Strands to refresh") ? { ok: true, text: "{}" } : naming(input); } });
    await x.detector.backfill(x.thread.id);
    x.thread.turn("Look at the router", "Ok.");
    await x.detector.idle(x.thread.id);
    await x.run();
    for (let index = 0; index < 30; index++) {
      x.clock.now += 3 * MIN;
      x.thread.turn(`router step ${index}`, "Ok.");
      await x.detector.idle(x.thread.id);
      await x.run();
    }
    expect(prompts.filter((prompt) => prompt.includes("Strands to refresh")).length).toBeLessThanOrEqual(1);
  });

  it("stops at its daily cap: names wait, with no try counted", async () => {
    const x = setup();
    await x.detector.backfill(x.thread.id);
    x.store.saveRead(x.thread.id, { day: DAY, modelCalls: MODEL_DAILY_CAP });
    x.thread.turn("Look at the router", "Ok.");
    await x.detector.idle(x.thread.id);
    const before = x.modelCalls.length;
    await x.detector.nameNow(x.thread.id);
    expect(x.modelCalls.length).toBe(before);
    expect(x.store.list(x.thread.id)[0]).toMatchObject({ named: false, nameTries: 0 });
    // A new day: both counts start again.
    x.clock.now += 24 * 60 * MIN;
    expect(x.store.callsLeft(x.thread.id, "model", "2026-11-21", MODEL_DAILY_CAP)).toBe(MODEL_DAILY_CAP);
    expect(x.store.callsLeft(x.thread.id, "jev", "2026-11-21", JEV_DAILY_CAP)).toBe(JEV_DAILY_CAP);
  });
});

describe("BB's one-line model call for naming", () => {
  /** The one-line call: the naming fake's JSON, on its own line (BB keeps the first clean line). */
  const quick = (prompts: string[], answer: "json" | "prose" | "fail" = "json"): NonNullable<DetectorDeps["completeText"]> => {
    const naming = fakeModel();
    return async ({ prompt }) => {
      prompts.push(prompt);
      if (answer === "fail") return { ok: false, error: "The title task is off" };
      if (answer === "prose") return { ok: true, text: "Model router" };
      const reply = await naming({ threadId: "thr_main", requestId: "x", prompt });
      return reply.ok ? { ok: true, text: JSON.stringify(JSON.parse(reply.text!.slice(reply.text!.indexOf("{")))) } : { ok: false, error: reply.error };
    };
  };

  it("names strands with it when this BB has it, and doesn't start the small model", async () => {
    const prompts: string[] = [];
    const x = setup({ completeText: quick(prompts) });
    await x.detector.backfill(x.thread.id);
    x.thread.turn("Look at the router", "Ok.");
    await x.detector.idle(x.thread.id);
    const before = x.modelCalls.length;
    await x.detector.nameNow(x.thread.id);
    expect(prompts.some((prompt) => prompt.includes("You name the strands"))).toBe(true);
    expect(x.modelCalls.length).toBe(before);
    expect(x.store.list(x.thread.id).map((strand) => strand.title)).toEqual(["Model router"]);
    expect(x.store.read(x.thread.id)!.modelCalls).toBeGreaterThan(0);
  });

  it("falls back to the small model when its answer isn't JSON or it fails", async () => {
    for (const answer of ["prose", "fail"] as const) {
      const x = setup({ completeText: quick([], answer) });
      await x.detector.backfill(x.thread.id);
      x.thread.turn("Look at the router", "Ok.");
      await x.detector.idle(x.thread.id);
      const before = x.modelCalls.length;
      await x.detector.nameNow(x.thread.id);
      expect(x.modelCalls.length).toBe(before + 1);
      expect(x.store.list(x.thread.id).map((strand) => strand.title)).toEqual(["Model router"]);
    }
  });
});

describe("the backfill and the conversations strands run in", () => {
  it("backfills once", async () => {
    const x = setup();
    x.thread.turn("Look at the router", "Ok.");
    expect(await x.detector.backfill(x.thread.id)).not.toBeNull();
    expect(await x.detector.backfill(x.thread.id)).toBeNull();
    expect(x.modelCalls.filter((prompt) => prompt.includes("Propose at most"))).toHaveLength(1);
  });

  it("does nothing for a thread that isn't a Bot's conversation (a worker), and reads nothing back for one", async () => {
    const db = database();
    const thread = new FakeThread("thr_other");
    thread.turn("Look at the router", "Ok.");
    const svc = new StrandService({
      db, conversation: (id) => (id === "thr_main" ? { botId: "bot", lastActiveAt: START } : null), conversationsOf: async () => [], events: thread.events, jev: fakeJev(), model: fakeModel(), changed: () => {}, log: () => {},
      setTimer: () => null, clearTimer: () => {}, workers: async () => [], interactions: async () => [], busy: async () => false,
    });
    await svc.idle("thr_other", true);
    expect(thread.pages).toBe(0);
    new StrandStore(db).create({ threadId: "thr_other", title: "Stored", origin: "jev", seq: 1, at: 1 });
    expect((await svc.list("thr_other")).strands).toEqual([]);
    expect(svc.items("thr_other", 10)).toEqual([]);
    expect(svc.tags("thr_other")).toEqual({ tags: [], strands: [], replies: [], opening: null });
  });

  it("lets an agent's `bb studio strands` see only its own Bot's conversations", () => {
    // Bot a: Main thr_main_a, conversation thr_a_chat, worker thr_a_worker. Bot b: Main thr_main_b, conversation thr_b_chat.
    const conversations = new Set(["thr_main_a", "thr_a_chat", "thr_main_b", "thr_b_chat"]);
    const scope = {
      enabled: (id: string) => conversations.has(id),
      botOf: (id: string) => (id.includes("_a") ? "a" : id.includes("_b") ? "b" : null),
      mainOf: (bot: string) => `thr_main_${bot}`,
      defaultMain: () => "thr_main_a",
    };
    expect(strandsThreadFor(null, "thr_a_chat", scope)).toBe("thr_a_chat");
    expect(strandsThreadFor(null, "thr_a_worker", scope)).toBe("thr_main_a");
    expect(strandsThreadFor("main", "thr_a_chat", scope)).toBe("thr_main_a");
    expect(strandsThreadFor("thr_a_chat", "thr_a_worker", scope)).toBe("thr_a_chat");
    expect(strandsThreadFor("thr_b_chat", "thr_a_worker", scope)).toBeNull();
    expect(strandsThreadFor("thr_main_b", "thr_a_chat", scope)).toBeNull();
    expect(strandsThreadFor(null, "thr_nobody", scope)).toBeNull();
    // The user's terminal: any Bot's conversation; with none named, the primary Bot's Main.
    expect(strandsThreadFor("thr_b_chat", null, scope)).toBe("thr_b_chat");
    expect(strandsThreadFor(null, null, scope)).toBe("thr_main_a");
    expect(strandsThreadFor("thr_a_worker", null, scope)).toBeNull();
  });
});

describe("secrets stay out of what strands send and keep", () => {
  const KEY = `sk-ant-api03-${"A1b2C3d4".repeat(6)}`;
  const OPENAI = `sk-proj-${"Zz9Yy8Xx".repeat(5)}`;
  const KNOWN = "correct-horse-battery-staple";
  const PEM = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQ\n-----END OPENSSH PRIVATE KEY-----";

  it("scrubs known values and token-shaped text", () => {
    const scrub = scrubber([KNOWN, "short"]);
    const out = scrub(`key ${KEY} and OPENAI_API_KEY=${OPENAI}, Bearer abcdefghij1234567890, ${KNOWN}, AKIAABCDEFGHIJKLMNOP, short words\n${PEM}`);
    for (const secret of [KEY, OPENAI, KNOWN, "abcdefghij1234567890", "AKIAABCDEFGHIJKLMNOP", "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQ"]) expect(out).not.toContain(secret);
    expect(out).toContain(REDACTED);
    expect(out).toContain("short words");
    expect(scrub("Look at the router fallback chain")).toBe("Look at the router fallback chain");
  });

  it("scrubs passwords in URLs, keeping the user and host", () => {
    const scrub = scrubber();
    const out = scrub("db is postgres://admin:Sup3rS3cret!@db.internal:5432/app and https://bot:tok-123abc@git.example.com/repo.git, see https://example.com/a@b");
    expect(out).not.toContain("Sup3rS3cret!");
    expect(out).not.toContain("tok-123abc");
    expect(out).toContain(`postgres://admin:${REDACTED}@db.internal:5432/app`);
    expect(out).toContain(`https://bot:${REDACTED}@git.example.com/repo.git`);
    expect(out).toContain("https://example.com/a@b");
  });

  it("scrubs the value of a pair named like a secret, keeping the name", () => {
    const scrub = scrubber();
    const cases: [string, string][] = [
      ["token: abc123def", "token: "],
      ["password=hunter2", "password="],
      ["api_key: k-998877", "api_key: "],
      ["apiKey=\"q1w2e3\"", "apiKey=\""],
      ["DB_PASSWORD=pa55word", "DB_PASSWORD="],
      ["GITHUB_TOKEN=gh-plain-value", "GITHUB_TOKEN="],
      ["client_secret: s3cr3t", "client_secret: "],
      ["passwd = letmein", "passwd = "],
    ];
    for (const [input, kept] of cases) {
      const out = scrub(`set ${input} now`);
      expect(out, input).toContain(`${kept}${REDACTED}`);
      expect(out, input).not.toMatch(/abc123def|hunter2|k-998877|q1w2e3|pa55word|gh-plain-value|s3cr3t|letmein/);
    }
    // Ordinary words that only look like the names stay.
    expect(scrub("the token is in the vault; password rules: 12 characters")).toBe("the token is in the vault; password rules: 12 characters");
  });

  it("sends Jev, the small model and the stored lines no secret", async () => {
    const x = setup({ secrets: [KNOWN] });
    x.thread.turn(`router: my key is ${KEY}, the vault phrase is ${KNOWN}`, `Set OPENAI_API_KEY=${OPENAI} and retried.`);
    await x.detector.backfill(x.thread.id);
    x.thread.turn(`router again with ${KEY}`, `Still ${OPENAI}`);
    await x.detector.idle(x.thread.id);
    await x.run();
    const sent = JSON.stringify([x.jevCalls, x.modelCalls]);
    const kept = JSON.stringify(x.db.prepare("SELECT line FROM strand_items").all()) + JSON.stringify(x.db.prepare("SELECT title, summary FROM strands").all());
    for (const secret of [KEY, OPENAI, KNOWN]) { expect(sent).not.toContain(secret); expect(kept).not.toContain(secret); }
    expect(x.jevCalls.length).toBeGreaterThan(0);
    expect(x.modelCalls.length).toBeGreaterThan(0);
  });
});
