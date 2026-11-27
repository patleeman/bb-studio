// Strands are never titled from host-injected envelopes: "[bb message from
// thread:thr_…]", "[bb system]", "[bb studio]", "[bb automation due:…]" or a
// <task-notification> block. Synthetic ids only.
import { describe, expect, it } from "vitest";
import { checkName, firstLineTitle, looksLikeEnvelope, stripEnvelopes, tidyName } from "./naming";
import { namingPrompt, proposePrompt, readNaming, readProposal } from "./sort";
import { StrandService } from "./service";
import { StrandStore, UNTITLED } from "./store";
import { database, FakeThread, FIXTURE_AT, fakeJev, fakeModel } from "./test/fixture";

const AGENT = "[bb message from thread:thr_synwork9001]";
const NOTIFICATION = "<task-notification>\n<task-id>task_syn01</task-id>\n<status>completed</status>\n<summary>Furnace filter sizes found</summary>\n</task-notification>";

describe("envelopes in strand titles", () => {
  it.each([
    [`${AGENT}\n\nRouter fallback is merged.`, "Router fallback is merged."],
    [`${AGENT} Router fallback is merged.`, "Router fallback is merged."],
    [`[bb message from thread:thr_synwork9001;reply=none]\n\nRouter fallback is merged.`, "Router fallback is merged."],
    ["[bb system]\n\n@thread:thr_synwork9002 completed:\n\nThe report is ready.", "The report is ready."],
    ["[bb studio] Watcher House: the porch light is on", "Watcher House: the porch light is on"],
    ["[bb automation due:aut_syn01]\nCheck-in \"Inbox\": two new bills", "Check-in \"Inbox\": two new bills"],
    [NOTIFICATION, "Furnace filter sizes found"],
    [`${AGENT}\n[bb system]\nNested envelopes`, "Nested envelopes"],
  ])("the provisional title skips the envelope: %j", (text, title) => {
    expect(firstLineTitle(text)).toBe(title);
    expect(looksLikeEnvelope(firstLineTitle(text))).toBe(false);
  });

  it("an envelope with no body gives a neutral title, never bracketed text", () => {
    for (const text of [AGENT, "[bb system]", "[bb message from thread:thr_synwork9001]\n\n", "<task-notification></task-notification>"]) {
      expect(firstLineTitle(text)).toBe("Untitled");
    }
  });

  it("keeps underscores inside words (ids, snake_case) and drops emphasis ones", () => {
    expect(firstLineTitle("Rename max_tokens in the router")).toBe("Rename max_tokens in the router");
    expect(firstLineTitle("_Router_ fallback")).toBe("Router fallback");
    expect(tidyName("thr_synwork9001 cleanup")).toBe("thr_synwork9001 cleanup");
    expect(tidyName("__Model router__")).toBe("Model router");
  });

  it.each([
    AGENT,
    "[bb message from thread:thrsynwork9001]",
    "bb message from thread:thrsynwork9001",
    "#[bb message from thread:thrsynwork9001]",
    "[bb system]",
    "[bb studio]",
    "<task-notification>",
    "[redacted]",
  ])("the sanitizer rejects %j", (title) => {
    expect(looksLikeEnvelope(title)).toBe(true);
    expect(checkName(tidyName(title))).toContain("envelope");
  });

  it.each(["Model router", "BB Studio release", "bb-plugins PR #15", "Thread search", "System prompt"])("the sanitizer keeps %j", (title) => {
    expect(looksLikeEnvelope(title)).toBe(false);
  });

  it("the naming and backfill prompts carry the content, not the envelope", () => {
    const naming = namingPrompt({ fresh: [{ key: "n1", messages: [`${AGENT}\n\nRouter fallback is merged.`] }], open: [], refresh: [] });
    const propose = proposePrompt([`${AGENT} Router fallback is merged.`], []);
    for (const prompt of [naming, propose]) {
      expect(prompt).toContain("Router fallback is merged.");
      expect(prompt).not.toContain("bb message from thread");
    }
    expect(stripEnvelopes(`${AGENT}\n\nbody`)).toBe("body");
  });

  it("a model answer that names a strand after an envelope is refused", () => {
    const naming = readNaming(JSON.stringify({ n1: { title: "[bb message from thread:thr_synwork9001]" }, n2: { title: "Model router" } }), ["n1", "n2"], []);
    expect(naming.answers.has("n1")).toBe(false);
    expect(naming.answers.get("n2")).toMatchObject({ kind: "name", title: "Model router" });
    const proposal = readProposal(JSON.stringify({ strands: [{ title: "[bb system]" }, { title: "Furnace tune-up" }] }), []);
    expect(proposal.strands.map((each) => each.title)).toEqual(["Furnace tune-up"]);
  });
});

describe("the store never keeps an envelope title", () => {
  it("create falls back to a neutral, unnamed title; named() ignores an envelope", () => {
    const store = new StrandStore(database(), () => FIXTURE_AT);
    const strand = store.create({ threadId: "thr_main", title: AGENT, named: true, origin: "jev", seq: 1, at: FIXTURE_AT });
    expect(store.get(strand.id)).toMatchObject({ title: UNTITLED, named: false });
    store.named(strand.id, "[bb system]", null);
    expect(store.get(strand.id)).toMatchObject({ title: UNTITLED, named: false });
  });

  it("repairs envelope titles once, from content or neutrally, and is idempotent", () => {
    const db = database();
    const store = new StrandStore(db, () => FIXTURE_AT);
    const insert = (id: string, title: string) => db.prepare(`INSERT INTO strands (id, thread_id, title, summary, named, summary_at, first_seq, last_seq, last_at, origin, task_id, created_at, parent_id)
      VALUES (?, 'thr_main', ?, NULL, 1, NULL, 1, 1, ?, 'jev', NULL, ?, NULL)`).run(id, title, FIXTURE_AT, FIXTURE_AT);
    insert("str_withcontent", "[bb message from thread:thrsynwork9001]");
    insert("str_empty", "bb message from thread:thrsynwork9002");
    insert("str_fine", "Model router");
    store.put({ threadId: "thr_main", seq: 1, kind: "report", turnId: "turn_1", at: FIXTURE_AT, line: `${AGENT}\n\nRouter fallback is merged.`, strandId: "str_withcontent", confidence: null, by: "inherit" });

    expect(store.repairEnvelopeTitles()).toBe(2);
    expect(store.get("str_withcontent")).toMatchObject({ title: "Router fallback is merged.", named: false, nameTries: 0 });
    expect(store.get("str_empty")).toMatchObject({ title: UNTITLED, named: false });
    expect(store.get("str_fine")).toMatchObject({ title: "Model router", named: true });

    const before = db.prepare("SELECT id, title, named, name_tries FROM strands ORDER BY id").all();
    expect(store.repairEnvelopeTitles()).toBe(0);
    expect(db.prepare("SELECT id, title, named, name_tries FROM strands ORDER BY id").all()).toEqual(before);
  });
});

describe("a strand started by an agent's message", () => {
  function service(db = database()) {
    const thread = new FakeThread("thr_main");
    const now = FIXTURE_AT + 60 * 60 * 1000;
    const svc = new StrandService({
      db,
      conversation: (id) => (id === "thr_main" ? { botId: "bot", lastActiveAt: now } : null),
      conversationsOf: async () => [{ threadId: "thr_main", title: "Main", isMain: true, lastActiveAt: now }],
      events: thread.events, jev: fakeJev(), model: fakeModel(), changed: () => {}, log: () => {}, now: () => now,
      setTimer: () => null, clearTimer: () => {},
      workers: async () => [], interactions: async () => [], busy: async () => false,
      conversationOfWorker: () => null,
    });
    return { svc, thread, now };
  }

  it("strand_note refuses an envelope as a title, and rename too", async () => {
    const x = service();
    x.thread.turn("Look at the router fallback", "Ok.", { at: x.now - 60_000 });
    await x.svc.idle("thr_main", true);
    const strand = (await x.svc.list("thr_main")).strands.find((each) => !each.trunk)!;
    expect(() => x.svc.note("thr_main", { strand: strand.id, title: "[bb message from thread:thr_synwork9001]" })).toThrow(/message header/);
    expect(x.svc.rename(strand.id, "[bb system]")).toBe(false);
  });

  it("the service repairs envelope titles when it starts", () => {
    const db = database();
    db.prepare(`INSERT INTO strands (id, thread_id, title, summary, named, summary_at, first_seq, last_seq, last_at, origin, task_id, created_at, parent_id)
      VALUES ('str_old', 'thr_main', '[bb message from thread:thrsynwork9001]', NULL, 1, NULL, 1, 1, ?, 'jev', NULL, ?, NULL)`).run(FIXTURE_AT, FIXTURE_AT);
    service(db);
    expect(new StrandStore(db).get("str_old")).toMatchObject({ title: UNTITLED, named: false });
  });
});
