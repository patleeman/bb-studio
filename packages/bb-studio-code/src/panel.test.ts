import { describe, expect, it } from "vitest";
import { canEmbedEditor } from "./panel";

describe("where VS Code can show", () => {
  it("embeds only on the computer running BB", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) expect(canEmbedEditor(host)).toBe(true);
    for (const host of ["red4.tailnet.ts.net", "192.168.1.20", "bb.example.com"]) expect(canEmbedEditor(host)).toBe(false);
  });
});

describe("card preview", () => {
  it("shortens folders to their last two parts", async () => {
    const { shortFolder } = await import("./card");
    expect(shortFolder("/tmp/data/worktrees/thr_x-1/orbit")).toBe("thr_x-1/orbit");
    expect(shortFolder("/orbit")).toBe("orbit");
  });
});

describe("BB shortcuts replayed from VS Code", () => {
  it("replays the key as ⌘ on macOS and Ctrl elsewhere, so BB's own listener sees it", async () => {
    const { replayKey } = await import("./panel");
    // Node has Event but not KeyboardEvent; this stand-in carries the same fields.
    (globalThis as { KeyboardEvent?: unknown }).KeyboardEvent ??= class extends Event {
      key: string; code: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean;
      constructor(type: string, init: KeyboardEventInit) {
        super(type, init);
        this.key = init.key ?? ""; this.code = init.code ?? ""; this.metaKey = !!init.metaKey; this.ctrlKey = !!init.ctrlKey; this.shiftKey = !!init.shiftKey; this.altKey = !!init.altKey;
      }
    };
    const seen: { key: string; meta: boolean; ctrl: boolean; shift: boolean }[] = [];
    const target = new EventTarget();
    target.addEventListener("keydown", (event) => { const key = event as KeyboardEvent; seen.push({ key: key.key, meta: key.metaKey, ctrl: key.ctrlKey, shift: key.shiftKey }); });
    replayKey({ key: "k", code: "KeyK", mod: true, shift: false, alt: false }, true, target);
    replayKey({ key: "O", code: "KeyO", mod: true, shift: true, alt: false }, false, target);
    expect(seen).toEqual([{ key: "k", meta: true, ctrl: false, shift: false }, { key: "O", meta: false, ctrl: true, shift: true }]);
  });
});
