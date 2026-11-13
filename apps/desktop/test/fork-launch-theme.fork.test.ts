import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  forkWindowBackground,
  readLaunchAppearance,
  writeLaunchAppearance,
} from "../src/fork-launch-theme-file.js";
import {
  FORK_LAUNCH_THEME_FILE,
  parseLaunchAppearance,
  type LaunchAppearance,
} from "../src/fork-launch-theme-ipc.js";
import {
  applyLaunchAppearance,
  isLaunchThemeWindow,
  whenRoot,
} from "../src/fork-launch-theme-preload.js";

const LAUNCH: LaunchAppearance = {
  version: 1,
  mode: "dark",
  background: "#0b1020",
  properties: [
    ["--background", "#0b1020"],
    ["--fork-surface-sidebar-background", "var(--studio-glass-sidebar)"],
  ],
  attributes: [["data-fork-backdrop", "studio/theme"]],
};

const dirs: string[] = [];
function userData(): string {
  const dir = mkdtempSync(join(tmpdir(), "fork-launch-theme-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("launch theme cache", () => {
  it("keeps the last appearance across launches and gives the window its background", () => {
    const dir = userData();
    expect(readLaunchAppearance(dir)).toBeNull();
    expect(forkWindowBackground(dir, "#151515")).toBe("#151515");
    writeLaunchAppearance(dir, LAUNCH);
    expect(readLaunchAppearance(dir)).toEqual(LAUNCH);
    expect(forkWindowBackground(dir, "#151515")).toBe("#0b1020");
    writeLaunchAppearance(dir, null);
    expect(readLaunchAppearance(dir)).toBeNull();
  });

  it("refuses what a page should not set: odd names, colors and sizes", () => {
    expect(parseLaunchAppearance({ ...LAUNCH, background: "red" })).toBeNull();
    expect(parseLaunchAppearance({ ...LAUNCH, properties: [["color", "red"]] })).toBeNull();
    expect(parseLaunchAppearance({ ...LAUNCH, attributes: [["onclick", "x"]] })).toBeNull();
    expect(parseLaunchAppearance({ ...LAUNCH, version: 2 })).toBeNull();
    expect(parseLaunchAppearance({ ...LAUNCH, mode: "dim" })).toBeNull();
    const dir = userData();
    writeLaunchAppearance(dir, LAUNCH);
    writeLaunchAppearance(dir, { ...LAUNCH, background: "url(x)" });
    expect(readLaunchAppearance(dir)).toEqual(LAUNCH);
    writeFileSync(join(dir, FORK_LAUNCH_THEME_FILE), "{");
    expect(readLaunchAppearance(dir)).toBeNull();
    expect(readFileSync(join(dir, FORK_LAUNCH_THEME_FILE), "utf8")).toBe("{");
  });

  it("paints the main window before the page runs, and leaves plugin and bare windows alone", () => {
    const set = new Map<string, string>();
    const attributes = new Map<string, string>();
    const classes = new Set<string>(["light"]);
    const appended: { id?: string; textContent?: string }[] = [];
    const root = {
      style: { setProperty: (name: string, value: string) => set.set(name, value) },
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      classList: { toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)) },
      ownerDocument: { createElement: () => ({}) },
      appendChild: (node: { id?: string; textContent?: string }) => appended.push(node),
    } as unknown as HTMLElement;
    applyLaunchAppearance(root, LAUNCH);
    expect(set.get("--background")).toBe("#0b1020");
    expect(set.get("background-color")).toBe("#0b1020");
    expect(set.get("color-scheme")).toBe("dark");
    expect(attributes.get("data-fork-backdrop")).toBe("studio/theme");
    expect(classes.has("dark")).toBe(true);
    expect(appended).toEqual([{ id: "fork-launch-theme", textContent: "body{background-color:#0b1020 !important}" }]);
    expect(isLaunchThemeWindow({ pathname: "/", search: "" })).toBe(true);
    const painted: unknown[] = [];
    const hook: { notify: (() => void) | null } = { notify: null };
    const doc = { documentElement: null as unknown };
    class FakeObserver {
      constructor(callback: () => void) { hook.notify = callback; }
      observe() {}
      disconnect() { hook.notify = null; }
    }
    const previous = globalThis.MutationObserver;
    globalThis.MutationObserver = FakeObserver as unknown as typeof MutationObserver;
    try {
      whenRoot(doc as unknown as Document, (element) => painted.push(element));
      expect(painted).toEqual([]);
      doc.documentElement = root;
      hook.notify?.();
      expect(painted).toEqual([root]);
      expect(hook.notify).toBeNull();
    } finally {
      globalThis.MutationObserver = previous;
    }
    expect(isLaunchThemeWindow({ pathname: "/fork-window/studio/account-warnings", search: "" })).toBe(false);
    expect(isLaunchThemeWindow({ pathname: "/threads/t", search: "?bbBare=1" })).toBe(false);
  });
});
