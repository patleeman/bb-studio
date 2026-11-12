import { describe, expect, it, vi } from "vitest";
import { canEmbedEditor, editorFrameAllow, editorView, frameIsBlank } from "./panel";

// The page shell (its nav, the picker's address) isn't part of these.
vi.mock("../kit/app/index", () => ({ BAR_BUTTON: "", Icon: () => null }));
vi.mock("../ui/studio-open", () => ({ useStudioOpen: () => vi.fn() }));

describe("what a workspace's view shows: never nothing", () => {
  const running = { state: "running" as const, url: "http://127.0.0.1:4100/?workspace=x", password: "pw", error: null };
  const state = (over: Partial<Parameters<typeof editorView>[0]> = {}) =>
    editorView({ embed: true, workspace: { folders: ["/repo"] }, loadError: "", status: running, openError: "", retried: false, released: false, ...over });
  const status = (name: "stopped" | "installing" | "starting" | "failed", error: string | null = null) => ({ state: name, url: null, password: null, error });

  it("loads, then says so when the workspace can't be read or is gone", () => {
    expect(state({ workspace: null })).toBe("loading");
    expect(state({ workspace: null, loadError: "Workspace not found." })).toBe("missing");
  });

  it("shows the editor once VS Code is up, and that it's starting until then", () => {
    expect(state()).toBe("editor");
    expect(state({ status: null })).toBe("starting");
    expect(state({ status: status("installing") })).toBe("installing");
    expect(state({ status: status("starting") })).toBe("starting");
    // A view on screen starts a stopped server itself, and retries a first failure once.
    expect(state({ status: status("stopped") })).toBe("starting");
    expect(state({ status: status("failed", "exited") })).toBe("starting");
    // Long out of sight, the frame is let go; back in view it starts again.
    expect(state({ released: true })).toBe("starting");
  });

  it("says it failed after the retry, or when the server refuses to start it at all", () => {
    expect(state({ status: status("failed", "exited"), retried: true })).toBe("failed");
    expect(state({ status: status("stopped"), openError: "This workspace's folder is gone: /repo" })).toBe("failed");
  });

  it("says a workspace with no folder has nothing to open, where it used to draw nothing", () => {
    expect(state({ workspace: { folders: [] }, status: status("stopped") })).toBe("no-folder");
  });

  it("is the read-only browser away from the computer running BB", () => {
    expect(state({ embed: false })).toBe("browser");
  });
});

describe("a frame that went blank", () => {
  it("is one with no document, or the empty one a moved frame starts over with", () => {
    expect(frameIsBlank(null)).toBe(true);
    expect(frameIsBlank({ contentWindow: null })).toBe(true);
    expect(frameIsBlank({ contentWindow: { location: { href: "about:blank" } } as Window })).toBe(true);
  });

  it("is not one showing another origin's page: the editor", () => {
    const editor = { get location(): Location { throw new Error("cross-origin"); } } as Window;
    expect(frameIsBlank({ contentWindow: editor })).toBe(false);
  });
});

describe("where VS Code can show", () => {
  it("embeds only on the computer running BB", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) expect(canEmbedEditor(host)).toBe(true);
    for (const host of ["homelab.tailnet.ts.net", "192.168.1.20", "bb.example.com"]) expect(canEmbedEditor(host)).toBe(false);
  });
});

describe("the editor frame's clipboard", () => {
  it("allows clipboard read and write for code-server's origin only", () => {
    expect(editorFrameAllow("http://127.0.0.1:4100/?workspace=%2Ftmp%2Fx.code-workspace")).toBe("clipboard-read http://127.0.0.1:4100; clipboard-write http://127.0.0.1:4100");
    expect(editorFrameAllow("http://localhost:51234/")).toBe("clipboard-read http://localhost:51234; clipboard-write http://localhost:51234");
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

describe("what the editor asks BB to open", () => {
  it("goes to the new thread, and opens BB's own preview of a file at its line", async () => {
    const { openFromEditor } = await import("./panel");
    const { wantsBbPreview } = await import("./bb-preview");
    const toThread = vi.fn();
    const preview = vi.fn((_options: unknown) => true);
    const navigate = { toThread, experimental_openFilePreview: preview };
    expect(openFromEditor(navigate, { kind: "thread", threadId: "thr_new" })).toBe(true);
    expect(toThread).toHaveBeenCalledWith("thr_new");
    const target = { kind: "workspace" as const, environmentId: "env_1", path: "src/retry.ts" };
    expect(openFromEditor(navigate, { kind: "file", target, line: 40 })).toBe(true);
    expect(preview).toHaveBeenCalledWith({ target, location: { kind: "line", line: 40, column: null } });
    // VS Code is the opener for this file: this one open is left to BB's preview.
    expect(wantsBbPreview("src/retry.ts")).toBe(true);
    // A BB without the preview call can't.
    expect(openFromEditor({ toThread }, { kind: "file", target, line: 1 })).toBe(false);
  });
});
