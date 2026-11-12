import { describe, expect, it, vi } from "vitest";
import { handleStudioLink } from "./link-handler";

const ORIGIN = "http://127.0.0.1:38986";

describe("the fork link handler", () => {
  it("routes links to registry entities by the modifier rule and leaves the rest to BB", () => {
    const open = vi.fn(async () => ({ via: "workbench" as const, pane: null, opened: true }));
    expect(handleStudioLink(`${ORIGIN}/plugins/studio/studio/pages/pg_1`, undefined, ORIGIN, open)).toBe(true);
    expect(open).toHaveBeenLastCalledWith(`${ORIGIN}/plugins/studio/studio/pages/pg_1`, { how: "workbench", source: "transcript" });
    expect(handleStudioLink("bb://conversation/thr_1", { modifiers: { meta: true } }, ORIGIN, open)).toBe(true);
    expect(open).toHaveBeenLastCalledWith("bb://conversation/thr_1", { how: "secondPane", source: "transcript" });
    expect(handleStudioLink("/threads/thr_1", { modifiers: { shift: true } }, ORIGIN, open)).toBe(true);
    expect(open).toHaveBeenLastCalledWith("/threads/thr_1", { how: "window", source: "transcript" });
    expect(handleStudioLink("https://example.com/plugins/studio/studio/pages/pg_1", undefined, ORIGIN, open)).toBe(false);
    expect(handleStudioLink(`${ORIGIN}/settings`, { modifiers: { meta: true } }, ORIGIN, open)).toBe(false);
    expect(handleStudioLink("mailto:a@b.c", undefined, ORIGIN, open)).toBe(false);
    expect(open).toHaveBeenCalledTimes(3);
  });
});
