import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { parseTakeMentionId, takeMentionId } from "../shared";
import { bytes, memoryStore } from "../test/db";
import { withLiveScript } from "./shim";
import { LiveStore, MAX_LIVE_JSON } from "./store";

function setup() {
  const { db, store } = memoryStore();
  const { artifact } = store.save({ name: "tool.html", mime: "text/html", bytes: bytes("<p>hi</p>"), projectId: null, by: "agent" });
  return { db, store, live: new LiveStore(db), id: artifact.id };
}

describe("LiveStore", () => {
  it("keeps state per artifact, versioned, and logs each save", () => {
    const { live, id } = setup();
    expect(live.state(id)).toMatchObject({ state: null, version: 0 });
    live.setState(id, { rate: 5 }, "user");
    const saved = live.setState(id, { rate: 6 }, "agent");
    expect(saved).toMatchObject({ state: { rate: 6 }, version: 2, updatedBy: "agent" });
    expect(live.events(id, 0).map((event) => [event.type, event.data])).toEqual([["state", { rate: 5 }], ["state", { rate: 6 }]]);
  });

  it("lists events after a seq", () => {
    const { live, id } = setup();
    live.log(id, "event", "play", { note: "C4" }, "user");
    const seq = live.lastSeq(id);
    live.log(id, "command", "reset", [], "agent");
    expect(live.events(id, seq)).toMatchObject([{ type: "command", name: "reset", data: [], by: "agent" }]);
  });

  it("refuses state that isn't JSON or is too large", () => {
    const { live, id } = setup();
    expect(() => live.setState(id, () => 1, "user")).toThrow(/JSON/);
    expect(() => live.setState(id, "x".repeat(MAX_LIVE_JSON), "user")).toThrow(/limit/);
  });

  it("keeps takes, and deleting the artifact removes its live rows", () => {
    const { live, store, id } = setup();
    live.setState(id, 1, "user");
    const take = live.addTake(id, "Take 1", [["C4", 0, 0.5]]);
    expect(live.take(take.id)).toMatchObject({ artifactId: id, label: "Take 1", data: [["C4", 0, 0.5]] });
    store.delete(id);
    expect(live.take(take.id)).toBeNull();
    expect(live.state(id).version).toBe(0);
    expect(live.lastSeq(id)).toBe(0);
  });
});

describe("take mentions", () => {
  it("round-trips and rejects other ids", () => {
    const id = takeMentionId("art_0123456789abcdef", "take_0123456789abcdef");
    expect(parseTakeMentionId(id)).toEqual({ artifactId: "art_0123456789abcdef", takeId: "take_0123456789abcdef" });
    expect(parseTakeMentionId("art_0123456789abcdef")).toBeNull();
    expect(parseTakeMentionId(`${id}/x`)).toBeNull();
  });
});

describe("withLiveScript", () => {
  const html = (page: string, state: unknown = { a: "</script>" }) => Buffer.from(withLiveScript(bytes(page), state, "dark")).toString("utf8");

  it("goes first in the head, so the page's scripts can use it", () => {
    const out = html("<!doctype html><html><head><title>t</title><script>use()</script></head></html>");
    expect(out.indexOf("window, \"playground\"")).toBeLessThan(out.indexOf("use()"));
    expect(out.startsWith("<!doctype html><html><head><script>")).toBe(true);
  });

  it("works on a fragment and escapes the state", () => {
    const out = html("<p>hi</p>");
    expect(out.startsWith("<script>")).toBe(true);
    expect(out.match(/<\/script>/g)).toHaveLength(1);
  });

  it("gives the page state, theme and the playground API", () => {
    const script = /<script>([\s\S]*)<\/script>/.exec(html("<p>hi</p>", { rate: 5 }))![1]!;
    const posted: unknown[] = [];
    const listeners: Record<string, (event: unknown) => void> = {};
    const window = {} as Record<string, unknown>;
    const parent = { postMessage: (message: unknown) => posted.push(message) };
    runInNewContext(script, {
      window,
      parent,
      navigator: {},
      addEventListener: (type: string, listener: (event: unknown) => void) => { listeners[type] = listener; },
      console,
    });
    const api = window.playground as { state: unknown; theme: string; save(v: unknown): void; expose(m: object): void; send(l: string, d: unknown): boolean };
    expect(api.state).toEqual({ rate: 5 });
    expect(api.theme).toBe("dark");
    api.save({ rate: 7 });
    api.expose({ reset: () => 1, notAFunction: 2 });
    expect(api.send("Take", [1])).toBe(true);
    expect(posted).toEqual([
      { type: "bb-artifact-live", op: "save", state: { rate: 7 } },
      { type: "bb-artifact-live", op: "expose", actions: ["reset"] },
      { type: "bb-artifact-live", op: "send", label: "Take", data: [1] },
    ]);
    // Only messages from the parent count.
    listeners.message!({ source: {}, data: { type: "bb-artifact-live", op: "state", state: 9 } });
    expect(api.state).toEqual({ rate: 7 });
    listeners.message!({ source: parent, data: { type: "bb-artifact-live", op: "state", state: 9 } });
    expect(api.state).toBe(9);
  });
});
