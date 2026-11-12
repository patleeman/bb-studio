// The bridge extension's side of an agent's change on disk, BB's theme and
// "this" in the editor, run against a small fake of VS Code. A file with
// unsaved edits must never be reloaded over.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BRIDGE_SOURCE } from "./bridge-extension";

let dir = "";
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), "sce-")); });
afterAll(() => rm(dir, { recursive: true, force: true }));

type Doc = { text: string; isDirty: boolean; uri: { fsPath: string; scheme: string }; lineCount: number; languageId: string; getText(range?: unknown): string; lineAt(n: number): { text: string } };

/** VS Code with one open document. `watcher`: whether VS Code reloads a clean file by itself when it changes on disk. */
function fakeVscode(path: string, text: string, options: { dirty?: boolean; watcher?: boolean; selection?: { start: [number, number]; end: [number, number] } } = {}) {
  const decorations: { type: string; lines: number[] }[] = [];
  const updates: [string, unknown][] = [];
  const settings: Record<string, unknown> = {};
  const commands: string[] = [];
  const messages: string[] = [];
  const doc: Doc = {
    text, isDirty: !!options.dirty, uri: { fsPath: path, scheme: "file" }, languageId: "typescript",
    get lineCount() { return doc.text.split("\n").length; },
    getText() { return doc.text; },
    lineAt(n) { return { text: doc.text.split("\n")[n] ?? "" }; },
  };
  const at = options.selection ?? { start: [0, 0], end: [0, 0] };
  const point = ([line, character]: [number, number]) => ({ line, character });
  const selection = { start: point(at.start as [number, number]), end: point(at.end as [number, number]), active: point(at.end as [number, number]), isEmpty: at.start[0] === at.end[0] && at.start[1] === at.end[1] };
  const editor = { document: doc, selection, setDecorations(type: { name: string }, ranges: { line: number }[]) { decorations.push({ type: type.name, lines: ranges.map((range) => range.line) }); } };
  let made = 0;
  const anything: unknown = new Proxy(function () {}, { get: () => anything, apply: () => anything, construct: () => anything as object });
  const open = <T extends object>(target: T) => new Proxy(target, { get: (object, key) => (key in object ? object[key as keyof T] : anything) });
  const vscode = open({
    Range: class { line: number; constructor(line: number) { this.line = line; } },
    Uri: { file: (fsPath: string) => ({ fsPath, scheme: "file" }) },
    ConfigurationTarget: { Global: 1 },
    workspace: open({
      textDocuments: [doc],
      asRelativePath: () => "src/a.ts",
      openTextDocument: async () => doc,
      getConfiguration: () => ({ get: (key: string) => settings[key], update: async (key: string, value: unknown, target: number) => { if (target !== 1) throw new Error("wrong target"); settings[key] = value; updates.push([key, value]); } }),
    }),
    window: open({
      activeTextEditor: editor,
      visibleTextEditors: [editor],
      // Each decoration type gets a number: the fifth made is the changed-lines tint (editMark).
      createTextEditorDecorationType: () => ({ name: `decoration-${++made}` }),
      setStatusBarMessage: (message: string) => { messages.push(message); },
    }),
    commands: open({
      executeCommand: async (name: string) => {
        commands.push(name);
        // Revert: the editor takes the file's text from disk.
        if (name === "workbench.action.files.revert") { doc.text = require("node:fs").readFileSync(path, "utf8"); doc.isDirty = false; }
      },
    }),
  });
  const module = { exports: {} as Record<string, unknown> };
  new Function("require", "exports", "process", "setTimeout", BRIDGE_SOURCE)(
    (name: string) => (name === "vscode" ? vscode : require(name)),
    module.exports,
    { env: {} },
    (fn: () => void) => { fn(); return 0; },
  );
  const extension = module.exports as {
    refresh(path: string): Promise<string>;
    remember(document: Doc): void;
    changedLines(before: string, after: string): number[];
    applyTheme(command: { base: string; colors: Record<string, string> }): Promise<boolean>;
    pointedAt(): { path: string; startLine: number; endLine: number; text: string; language: string; where: string } | null;
  };
  /** The agent writes the file; with a watcher, VS Code reloads a clean buffer by itself. */
  const agentWrites = async (next: string) => { await writeFile(path, next); if (options.watcher && !doc.isDirty) doc.text = next; };
  const tinted = () => decorations.filter((each) => each.type === "decoration-5").at(-1)?.lines ?? [];
  return { extension, doc, agentWrites, tinted, commands, messages, updates, settings };
}

const BEFORE = "const a = 1;\nconst b = 2;\nconst c = 3;\n";
const AFTER = "const a = 1;\nconst b = 20;\nconst extra = true;\nconst c = 3;\n";

describe("a file an agent changed on disk", () => {
  it("reloads a clean buffer from disk and tints the changed lines", async () => {
    const path = join(dir, "clean.ts");
    await writeFile(path, BEFORE);
    const x = fakeVscode(path, BEFORE);
    x.extension.remember(x.doc);
    await x.agentWrites(AFTER);
    expect(await x.extension.refresh(path)).toBe("reloaded");
    expect(x.doc.text).toBe(AFTER);
    expect(x.commands).toEqual(["workbench.action.files.revert"]);
    expect(x.tinted()).toEqual([1, 2]);
  });

  it("tints what changed when VS Code had already reloaded the file itself, without reverting", async () => {
    const path = join(dir, "watched.ts");
    await writeFile(path, BEFORE);
    const x = fakeVscode(path, BEFORE, { watcher: true });
    x.extension.remember(x.doc);
    await x.agentWrites(AFTER);
    expect(await x.extension.refresh(path)).toBe("reloaded");
    expect(x.commands).toEqual([]);
    expect(x.tinted()).toEqual([1, 2]);
    // The next change is measured from this one.
    await x.agentWrites(`${AFTER}const d = 4;\n`);
    await x.extension.refresh(path);
    expect(x.tinted()).toEqual([1, 2, 4]);
  });

  it("never touches a buffer with unsaved edits, and says so", async () => {
    const path = join(dir, "dirty.ts");
    await writeFile(path, BEFORE);
    const mine = "const a = 1;\nconst mine = 'unsaved';\n";
    const x = fakeVscode(path, mine, { dirty: true });
    await x.agentWrites(AFTER);
    expect(await x.extension.refresh(path)).toBe("unsaved");
    expect(x.doc.text).toBe(mine);
    expect(x.doc.isDirty).toBe(true);
    expect(x.commands).toEqual([]);
    expect(x.tinted()).toEqual([]);
    expect(x.messages.join("\n")).toContain("Your unsaved edits are kept");
  });

  it("leaves files that aren't open, or are gone, alone", async () => {
    const path = join(dir, "open.ts");
    await writeFile(path, BEFORE);
    const x = fakeVscode(path, BEFORE);
    expect(await x.extension.refresh(join(dir, "other.ts"))).toBe("closed");
    await rm(path);
    expect(await x.extension.refresh(path)).toBe("gone");
    expect(x.doc.text).toBe(BEFORE);
  });

  it("finds the changed lines between what both texts share at the start and the end", () => {
    const { changedLines } = fakeVscode(join(dir, "x.ts"), "").extension;
    expect(changedLines("a\nb\nc", "a\nB\nc")).toEqual([1]);
    expect(changedLines("a\nc", "a\nb1\nb2\nc")).toEqual([1, 2]);
    expect(changedLines("a\nb\nc", "a\nc")).toEqual([]);
    expect(changedLines("a\nb", "a\nb")).toEqual([]);
    expect(changedLines("", "new\nfile")).toEqual([0, 1]);
  });
});

describe("BB's theme, in place", () => {
  it("writes the colors and the base theme to the user's settings, with no reload", async () => {
    const x = fakeVscode(join(dir, "t.ts"), "");
    expect(await x.extension.applyTheme({ base: "Light Modern", colors: { "editor.background": "#ffffff" } })).toBe(true);
    expect(x.settings).toEqual({ "window.autoDetectColorScheme": false, "workbench.colorTheme": "Light Modern", "workbench.colorCustomizations": { "editor.background": "#ffffff" } });
    // The same mode again only updates the colors.
    await x.extension.applyTheme({ base: "Light Modern", colors: { "editor.background": "#fafafa" } });
    expect(x.updates.slice(3)).toEqual([["workbench.colorCustomizations", { "editor.background": "#fafafa" }]]);
    expect(x.commands).toEqual([]);
  });
});

describe("what \"this\" is in the editor", () => {
  it("is the selection's lines, or the cursor's line with no selection", () => {
    const text = "one\ntwo\nthree\nfour\n";
    const path = join(dir, "p.ts");
    expect(fakeVscode(path, text, { selection: { start: [1, 0], end: [1, 0] } }).extension.pointedAt()).toMatchObject({ path, startLine: 2, endLine: 2, text: "two", language: "typescript", where: "src/a.ts:2" });
    // A selection ending at the start of a line doesn't take that line.
    expect(fakeVscode(path, text, { selection: { start: [1, 0], end: [3, 0] } }).extension.pointedAt()).toMatchObject({ startLine: 2, endLine: 3, where: "src/a.ts:2–3" });
  });
});
