import { describe, expect, it } from "vitest";
import { nextInstructions } from "./prompt";
import { reactionReplies, trackReactionReplies } from "./reactions";

const DEFAULTS = ["👍 Looks good"];
function sdk(plugin: { enabled: boolean; status?: string } | null, values: Record<string, unknown> = {}, hang = false) {
  return {
    plugins: {
      list: async () => ({ plugins: plugin ? [{ id: "emoji-react", ...plugin }] : [] }),
      getSettings: () => (hang ? new Promise<never>(() => {}) : Promise.resolve({ values })),
    },
  };
}

describe("reactionReplies", () => {
  it("offers replies only while Reactions runs with smart reactions on", async () => {
    expect(await reactionReplies(sdk({ enabled: true, status: "running" }, { smartReactions: true, emojiItems: "✅ Do it, ❓ Clarify" }), DEFAULTS)).toEqual(["✅ Do it", "❓ Clarify"]);
    expect(await reactionReplies(sdk({ enabled: true, status: "running" }, { smartReactions: true }), DEFAULTS)).toEqual(DEFAULTS);
  });

  it("offers none when smart reactions are off, Reactions is missing, disabled, failed or hung", async () => {
    expect(await reactionReplies(sdk({ enabled: true, status: "running" }, { smartReactions: false }), DEFAULTS)).toBeNull();
    expect(await reactionReplies(sdk({ enabled: true, status: "running" }, {}), DEFAULTS)).toBeNull();
    expect(await reactionReplies(sdk(null), DEFAULTS)).toBeNull();
    expect(await reactionReplies(sdk({ enabled: false, status: "running" }, { smartReactions: true }), DEFAULTS)).toBeNull();
    expect(await reactionReplies(sdk({ enabled: true, status: "error" }, { smartReactions: true }), DEFAULTS)).toBeNull();
    expect(await reactionReplies(sdk({ enabled: true, status: "running" }, {}, true), DEFAULTS, 20)).toBeNull();
  });
});

describe("nextInstructions without replies", () => {
  it("leaves the reply attribute out entirely", () => {
    const text = nextInstructions({ explore: true, replies: null });
    expect(text).not.toContain('reply="');
    expect(text).not.toContain("- reply:");
    expect(text).toContain("No reply attribute");
    expect(nextInstructions({ explore: true, replies: [] })).toContain('reply="');
  });
});

describe("trackReactionReplies", () => {
  const on = { enabled: true, status: "running" };
  it("keeps the last known answer when a check fails, and turns off only on a successful off", async () => {
    let fail = false;
    let smart = true;
    const base = sdk(on, {});
    const live = {
      plugins: {
        list: async () => { if (fail) throw new Error("down"); return base.plugins.list(); },
        getSettings: async () => ({ values: { smartReactions: smart } }),
      },
    };
    const tracker = trackReactionReplies(live, DEFAULTS, 20);
    expect(tracker.current()).toBeUndefined();
    expect(await tracker.refresh()).toEqual(DEFAULTS);
    fail = true;
    expect(await tracker.refresh()).toEqual(DEFAULTS);
    fail = false;
    smart = false;
    expect(await tracker.refresh()).toBeNull();
    tracker.dispose();
  });

  it("starts from the answer saved before a restart until a check succeeds", async () => {
    const saved = new Map<string, unknown>([["explore:replies", { replies: ["✅ Do it"] }]]);
    const memory = { get: async <T,>(key: string) => saved.get(key) as T | undefined, set: async (key: string, value: unknown) => void saved.set(key, value) };
    const hung = sdk(on, {}, true);
    const tracker = trackReactionReplies(hung, DEFAULTS, 20, memory);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(tracker.current()).toEqual(["✅ Do it"]);
    await tracker.refresh();
    expect(tracker.current()).toEqual(["✅ Do it"]);
    tracker.dispose();
    const fresh = trackReactionReplies(sdk(on, { smartReactions: false }), DEFAULTS, 20, memory);
    await fresh.refresh();
    expect(fresh.current()).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(saved.get("explore:replies")).toEqual({ replies: null });
    fresh.dispose();
  });
});

describe("replies for a new session", () => {
  it("offers none until an answer is known, then follows it", async () => {
    const { repliesForSession } = await import("./reactions");
    expect(repliesForSession(undefined)).toBeNull();
    expect(repliesForSession(null)).toBeNull();
    expect(repliesForSession(["👍 Yes"])).toEqual(["👍 Yes"]);
  });
});
