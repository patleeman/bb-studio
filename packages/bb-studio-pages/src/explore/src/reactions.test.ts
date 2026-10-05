import { describe, expect, it } from "vitest";
import { nextInstructions } from "./prompt";
import { reactionReplies } from "./reactions";

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
