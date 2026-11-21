// strand_note: the agents' one strands tool (phase 5), in place of the task
// tools: mark a strand waiting on someone, done, or renamed.
import { describe, expect, it } from "vitest";
import { strandList, strandNoteInput } from "./contract";
import { StrandService, type WorkerFact } from "./service";
import { database, FakeThread, FIXTURE_AT, fakeJev, fakeModel } from "./test/fixture";

const NOW = FIXTURE_AT + 60 * 60 * 1000;

function setup() {
  const db = database();
  const thread = new FakeThread("thr_main");
  const workers: WorkerFact[] = [];
  let now = NOW;
  const changed: string[] = [];
  const svc = new StrandService({
    db,
    conversation: (id) => (id === "thr_main" ? { botId: "bot", lastActiveAt: now } : null),
    conversationsOf: async () => [{ threadId: "thr_main", title: "Main", isMain: true, lastActiveAt: now }],
    events: thread.events, jev: fakeJev(), model: fakeModel(), changed: (id) => changed.push(id), log: () => {}, now: () => now,
    setTimer: () => null, clearTimer: () => {},
    workers: async () => workers, interactions: async () => [], busy: async () => false,
    conversationOfWorker: (id) => (id === "thr_worker" ? "thr_main" : null),
  });
  return { db, svc, thread, workers, changed, at: (next: number) => { now = next; } };
}

async function sorted() {
  const x = setup();
  x.thread.turn("Look at the router fallback", "Starting a worker.", { at: NOW - 3 * 60_000 });
  x.thread.turn("Book the dentist for Tuesday", "Ok.", { at: NOW - 60_000 });
  await x.svc.idle("thr_main", true);
  const list = await x.svc.list("thr_main");
  const byTitle = (title: string) => list.strands.find((each) => each.title === title)!;
  return { ...x, router: byTitle("Model router"), dentist: byTitle("Dentist appointment") };
}

describe("strand_note", () => {
  it("marks the strand of the caller's newest turn waiting, which clears on its next activity", async () => {
    const x = await sorted();
    expect(x.svc.note("thr_main", { waitingOn: "Dana's review" }).line).toBe(`Strand "Dentist appointment" (${x.dentist.id}): waiting on Dana's review until its next activity.`);
    expect(x.changed).toContain("thr_main");
    expect((await x.svc.list("thr_main")).strands.find((each) => each.id === x.dentist.id)).toMatchObject({ state: "waiting", detail: "Dana's review" });
    x.at(NOW + 120_000);
    x.thread.turn("Dentist moved to Wednesday", "Ok.", { at: NOW + 60_000 });
    await x.svc.idle("thr_main", true);
    expect((await x.svc.list("thr_main")).strands.find((each) => each.id === x.dentist.id)?.state).toBe("active");
  });

  it("names a strand by title or id; done folds it into Earlier until its next activity", async () => {
    const x = await sorted();
    expect(x.svc.note("thr_main", { strand: "model router", done: true }).strandId).toBe(x.router.id);
    const list = strandList.parse(await x.svc.list("thr_main"));
    expect(list.strands.map((each) => each.id)).not.toContain(x.router.id);
    expect(list.earlier.find((each) => each.id === x.router.id)).toMatchObject({ state: "quiet", detail: "Done" });
    x.svc.note("thr_main", { strand: x.router.id, done: false });
    expect((await x.svc.list("thr_main")).strands.find((each) => each.id === x.router.id)?.state).toBe("active");
  });

  it("from a worker, notes the strand that holds the worker", async () => {
    const x = await sorted();
    x.workers.push({ threadId: "thr_worker", title: "Router fix", status: "running", createdAt: NOW - 3 * 60_000 + 2, endedAt: null });
    await x.svc.list("thr_main");
    expect(x.svc.note("thr_worker", { waitingOn: "CI run 42" }).strandId).toBe(x.router.id);
  });

  it("renames, refusing a name another strand has, and says what's wrong in plain words", async () => {
    const x = await sorted();
    expect(x.svc.note("thr_main", { strand: x.router.id, title: "Router fallback" }).line).toBe(`Strand "Router fallback" (${x.router.id}): renamed to "Router fallback".`);
    expect(() => x.svc.note("thr_main", { strand: x.router.id, title: "Dentist appointment" })).toThrow('Another strand here is called "Dentist appointment".');
    expect(() => x.svc.note("thr_main", { strand: "Taxes" })).toThrow(/^No strand "Taxes" here\. Strands: /);
    expect(() => x.svc.note("thr_main", {})).toThrow("Say what to note: waitingOn, done or title.");
    expect(() => x.svc.note("thr_other", { done: true })).toThrow(/has no strands/);
    expect(() => x.svc.note(null, { done: true })).toThrow(/works in a Bot's conversation/);
  });

  it("before anything is sorted, asks for a strand", () => {
    const x = setup();
    expect(() => x.svc.note("thr_main", { done: true })).toThrow(/No strand to note yet/);
  });

  it("takes only waitingOn, done, title and strand", () => {
    expect(strandNoteInput.safeParse({ waitingOn: null }).success).toBe(true);
    expect(strandNoteInput.safeParse({ state: "done" }).success).toBe(false);
  });
});
