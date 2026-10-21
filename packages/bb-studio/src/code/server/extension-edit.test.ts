// The bridge extension's live edit, run against a small fake of VS Code with
// a real text buffer: it must roll back a failed edit, keep the user's typing
// out of its undo step, and not save when the user typed meanwhile.
import { describe, expect, it } from "vitest";
import { BRIDGE_SOURCE } from "./bridge-extension";

type Change = { rangeOffset: number; rangeLength: number; text: string };

function fakeVscode(initial: string, options: { failOnEdit?: number; onEdit?: (count: number, doc: { text: string }) => void } = {}) {
  const listeners: ((event: { document: Doc; contentChanges: Change[] }) => void)[] = [];
  const undoStops: boolean[] = [];
  let edits = 0;
  class Position { constructor(public offset: number) {} }
  class Range { start: Position; end: Position; constructor(a: Position | number, b: Position | number) { this.start = typeof a === "number" ? new Position(a) : a; this.end = typeof b === "number" ? new Position(b) : b; } }
  const doc = {
    text: initial,
    isDirty: false,
    saved: 0,
    uri: { fsPath: "/repo/a.ts", scheme: "file" },
    lineCount: 1,
    getText() { return doc.text; },
    positionAt(offset: number) { return new Position(offset); },
    async save() { doc.saved += 1; doc.isDirty = false; return true; },
    /** The user typing: a change that isn't the extension's. */
    type(offset: number, text: string) {
      doc.text = doc.text.slice(0, offset) + text + doc.text.slice(offset);
      doc.isDirty = true;
      for (const listener of listeners) listener({ document: doc, contentChanges: [{ rangeOffset: offset, rangeLength: 0, text }] });
    },
  };
  type Doc = typeof doc;
  const editor = {
    document: doc,
    async edit(callback: (builder: unknown) => void, opts: { undoStopBefore: boolean }) {
      edits += 1;
      undoStops.push(opts.undoStopBefore);
      if (options.failOnEdit === edits) return false;
      const changes: Change[] = [];
      callback({
        insert: (at: Position, text: string) => changes.push({ rangeOffset: at.offset, rangeLength: 0, text }),
        replace: (range: Range, text: string) => changes.push({ rangeOffset: range.start.offset, rangeLength: range.end.offset - range.start.offset, text }),
        delete: (range: Range) => changes.push({ rangeOffset: range.start.offset, rangeLength: range.end.offset - range.start.offset, text: "" }),
      });
      for (const change of changes) {
        doc.text = doc.text.slice(0, change.rangeOffset) + change.text + doc.text.slice(change.rangeOffset + change.rangeLength);
        doc.isDirty = true;
      }
      if (changes.length) for (const listener of listeners) listener({ document: doc, contentChanges: changes });
      options.onEdit?.(edits, doc);
      return true;
    },
    setDecorations() {},
    revealRange() {},
  };
  const anything: unknown = new Proxy(function () {}, { get: () => anything, apply: () => anything, construct: () => anything as object });
  const vscode = new Proxy({
    Range, Position,
    Uri: { file: (path: string) => ({ fsPath: path, scheme: "file" }) },
    workspace: new Proxy({
      openTextDocument: async () => doc,
      asRelativePath: () => "a.ts",
      onDidChangeTextDocument: (listener: (event: { document: Doc; contentChanges: Change[] }) => void) => { listeners.push(listener); return { dispose: () => listeners.splice(listeners.indexOf(listener), 1) }; },
    }, { get: (target, key) => (key in target ? target[key as keyof typeof target] : anything) }),
    window: new Proxy({
      showTextDocument: async () => editor,
      setStatusBarMessage: () => undefined,
      createTextEditorDecorationType: () => ({}),
    }, { get: (target, key) => (key in target ? target[key as keyof typeof target] : anything) }),
  }, { get: (target, key) => (key in target ? target[key as keyof typeof target] : anything) });
  return { vscode, doc, undoStops };
}

function load(vscode: unknown) {
  const module = { exports: {} as Record<string, unknown> };
  new Function("require", "exports", "process", "setTimeout", BRIDGE_SOURCE)(
    (name: string) => (name === "vscode" ? vscode : require(name)),
    module.exports,
    { env: {} },
    (fn: () => void) => { fn(); return 0; },
  );
  return module.exports as { edit(command: unknown): Promise<string> };
}

const command = { type: "edit", path: "/repo/a.ts", edits: [{ oldText: "const a = 1;", newText: "const a = 1;\nconst b = 2;\nconst c = 3;" }] };

describe("live edit in the user's editor", () => {
  it("types the edit and saves a file that had no unsaved changes", async () => {
    const { vscode, doc } = fakeVscode("const a = 1;\n");
    await load(vscode).edit(command);
    expect(doc.text).toBe("const a = 1;\nconst b = 2;\nconst c = 3;\n");
    expect(doc.saved).toBe(1);
  });

  it("rolls the file back when the edit fails partway", async () => {
    const { vscode, doc } = fakeVscode("const a = 1;\n", { failOnEdit: 4 });
    await expect(load(vscode).edit(command)).rejects.toThrow(/rolled back/i);
    expect(doc.text).toBe("const a = 1;\n");
    expect(doc.saved).toBe(0);
  });

  it("keeps the user's typing out of its undo step, and doesn't save when they typed", async () => {
    const harness = fakeVscode("const a = 1;\n// user\n", { onEdit: (count, doc) => { if (count === 2) (doc as unknown as { type(at: number, text: string): void }).type(doc.text.length, "x"); } });
    const result = await load(harness.vscode).edit(command);
    expect(harness.doc.text.endsWith("// user\nx")).toBe(true);
    expect(harness.doc.text).toContain("const c = 3;");
    expect(harness.doc.saved).toBe(0);
    expect(result).toMatch(/typed/i);
    // After their keystroke, the extension's next change starts a new undo step.
    expect(harness.undoStops.slice(2)).toContain(true);
  });
});
