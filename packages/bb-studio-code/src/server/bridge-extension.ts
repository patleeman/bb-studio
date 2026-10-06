// The BB bridge: a VS Code extension Studio Code installs into every
// workspace. It reports what the user has in front of them to the plugin,
// and does what the agent asks (show these lines). It talks over the Unix
// socket named in STUDIO_CODE_BRIDGE, which the plugin sets per workspace.
// The source is plain JavaScript (no build), kept here as text so the
// bundled plugin can write it out.
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Raise with every change to the extension, so workspaces get the new one. */
export const BRIDGE_VERSION = "0.1.0";
const NAME = "studio-bridge";
const PUBLISHER = "bb";
export const BRIDGE_ID = `${PUBLISHER}.${NAME}`;

const MANIFEST = {
  name: NAME,
  publisher: PUBLISHER,
  displayName: "BB Studio bridge",
  description: "Shares what you're looking at with BB's agent, and lets it point you at code.",
  version: BRIDGE_VERSION,
  engines: { vscode: "^1.80.0" },
  main: "./extension.js",
  activationEvents: ["onStartupFinished"],
  contributes: {
    commands: [{ command: "bbStudio.copyForChat", title: "Copy for BB chat", category: "BB" }],
    menus: { "editor/context": [{ command: "bbStudio.copyForChat", when: "editorHasSelection", group: "9_cutcopypaste@9" }] },
  },
};

const EXTENSION = String.raw`"use strict";
const vscode = require("vscode");
const http = require("node:http");

const SOCKET = process.env.STUDIO_CODE_BRIDGE;
const MAX_SELECTION = 8000;

function post(path, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = http.request({ socketPath: SOCKET, path, method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data) } }, (res) => { res.resume(); res.on("end", resolve); });
    req.on("error", resolve);
    req.end(data);
  });
}

function fileOf(document) {
  return document && document.uri.scheme === "file" ? document.uri.fsPath : null;
}

function snapshot() {
  const editor = vscode.window.activeTextEditor;
  let activeFile = null;
  const path = editor && fileOf(editor.document);
  if (editor && path) {
    const selection = editor.selection;
    const text = editor.document.getText(selection);
    const visible = editor.visibleRanges[0];
    const problems = vscode.languages.getDiagnostics(editor.document.uri)
      .filter((d) => d.severity <= vscode.DiagnosticSeverity.Warning)
      .slice(0, 20)
      .map((d) => ({ line: d.range.start.line + 1, severity: d.severity === vscode.DiagnosticSeverity.Error ? "error" : "warning", message: String(d.message).slice(0, 400) }));
    activeFile = {
      path,
      language: editor.document.languageId,
      selection: { startLine: selection.start.line + 1, startColumn: selection.start.character + 1, endLine: selection.end.line + 1, endColumn: selection.end.character + 1 },
      selectedText: text.length > MAX_SELECTION ? text.slice(0, MAX_SELECTION) + "\n…" : text,
      visible: visible ? { startLine: visible.start.line + 1, endLine: visible.end.line + 1 } : null,
      problems,
    };
  }
  const open = [];
  for (const group of vscode.window.tabGroups.all) for (const tab of group.tabs) {
    const uri = tab.input && tab.input.uri;
    if (uri && uri.scheme === "file" && !open.includes(uri.fsPath)) open.push(uri.fsPath);
  }
  const unsaved = vscode.workspace.textDocuments.filter((d) => d.isDirty && fileOf(d)).map((d) => d.uri.fsPath);
  return { focused: vscode.window.state.focused, activeFile, openFiles: open.slice(0, 50), unsavedFiles: unsaved.slice(0, 50) };
}

let timer = null;
function report() {
  clearTimeout(timer);
  timer = setTimeout(() => post("/state", snapshot()), 300);
}

const highlight = vscode.window.createTextEditorDecorationType({
  isWholeLine: true,
  backgroundColor: new vscode.ThemeColor("editor.findMatchHighlightBackground"),
  overviewRulerColor: new vscode.ThemeColor("editorOverviewRuler.findMatchForeground"),
  overviewRulerLane: vscode.OverviewRulerLane.Center,
});
let clearHighlight = null;

async function show(command) {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(command.path));
  const last = Math.max(document.lineCount, 1);
  const start = Math.min(Math.max(command.startLine, 1), last) - 1;
  const end = Math.min(Math.max(command.endLine, command.startLine), last) - 1;
  const editor = await vscode.window.showTextDocument(document, { preview: false, preserveFocus: false });
  const range = new vscode.Range(start, 0, end, document.lineAt(end).text.length);
  editor.selection = new vscode.Selection(range.start, range.end);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  editor.setDecorations(highlight, [range]);
  if (clearHighlight) clearHighlight.dispose();
  // The highlight stays until the user moves on.
  clearHighlight = vscode.window.onDidChangeTextEditorSelection((event) => {
    if (event.kind !== vscode.TextEditorSelectionChangeKind.Command) {
      editor.setDecorations(highlight, []);
      if (clearHighlight) { clearHighlight.dispose(); clearHighlight = null; }
    }
  });
  vscode.window.setStatusBarMessage("$(sparkle) BB showed you " + vscode.workspace.asRelativePath(document.uri) + ":" + (start + 1) + (end > start ? "–" + (end + 1) : ""), 6000);
}

let stopped = false;
function listen() {
  if (stopped) return;
  const req = http.get({ socketPath: SOCKET, path: "/events" }, (res) => {
    res.setEncoding("utf8");
    let buffer = "";
    res.on("data", (chunk) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const event = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        for (const line of event.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          let command;
          try { command = JSON.parse(line.slice(6)); } catch { continue; }
          if (command && command.type === "show") show(command).catch((error) => vscode.window.showWarningMessage("BB couldn't show that: " + error.message));
        }
      }
    });
    res.on("end", () => setTimeout(listen, 2000));
    // A fresh connection tells the plugin what's on screen now.
    report();
  });
  req.on("error", () => setTimeout(listen, 2000));
}

async function copyForChat() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) return;
  const { start, end } = editor.selection;
  const text = editor.document.getText(editor.selection);
  const fence = text.includes("` + "```" + String.raw`") ? "` + "````" + String.raw`" : "` + "```" + String.raw`";
  const where = vscode.workspace.asRelativePath(editor.document.uri) + (start.line === end.line ? ":" + (start.line + 1) : ":" + (start.line + 1) + "–" + (end.line + 1));
  await vscode.env.clipboard.writeText(where + "\n" + fence + editor.document.languageId + "\n" + text + "\n" + fence + "\n");
  vscode.window.setStatusBarMessage("$(check) Copied " + where + " for BB chat. The agent already sees your selection, too.", 5000);
}

exports.activate = (context) => {
  context.subscriptions.push(vscode.commands.registerCommand("bbStudio.copyForChat", copyForChat));
  if (!SOCKET) return;
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(report),
    vscode.window.onDidChangeTextEditorSelection(report),
    vscode.window.onDidChangeTextEditorVisibleRanges(report),
    vscode.window.onDidChangeWindowState(report),
    vscode.window.tabGroups.onDidChangeTabs(report),
    vscode.workspace.onDidChangeTextDocument((event) => { if (event.document.isDirty !== undefined) report(); }),
    vscode.workspace.onDidSaveTextDocument(report),
    vscode.languages.onDidChangeDiagnostics(report),
    { dispose: () => { stopped = true; } },
  );
  listen();
};
exports.deactivate = () => { stopped = true; };
`;

type RegistryEntry = { identifier?: { id?: string }; version?: string; [key: string]: unknown };

async function readJson<T>(file: string, fallback: T): Promise<T> {
  if (!existsSync(file)) return fallback;
  try { return JSON.parse(await readFile(file, "utf8")) as T; } catch { return fallback; }
}

/**
 * Writes the bridge into the shared extensions folder and registers it.
 * VS Code keeps its own list of installed extensions (extensions.json): a
 * folder missing from an existing list is taken as uninstalled and marked
 * for removal (.obsolete), so the bridge adds its entry and clears that
 * mark. Older versions are removed.
 */
export async function installBridge(extensionsDir: string): Promise<void> {
  const name = `${BRIDGE_ID}-${BRIDGE_VERSION}`;
  const folder = join(extensionsDir, name);
  await mkdir(extensionsDir, { recursive: true });
  for (const entry of await readdir(extensionsDir)) {
    if (entry.startsWith(`${BRIDGE_ID}-`) && entry !== name) await rm(join(extensionsDir, entry), { recursive: true, force: true });
  }
  const current = existsSync(join(folder, "extension.js")) && (await readFile(join(folder, "extension.js"), "utf8")) === EXTENSION;
  if (!current) {
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "package.json"), `${JSON.stringify(MANIFEST, null, 2)}\n`);
    await writeFile(join(folder, "extension.js"), EXTENSION);
  }
  const registryFile = join(extensionsDir, "extensions.json");
  const registry = await readJson<RegistryEntry[]>(registryFile, []);
  const others = Array.isArray(registry) ? registry.filter((entry) => entry.identifier?.id !== BRIDGE_ID) : [];
  const ours = { identifier: { id: BRIDGE_ID }, version: BRIDGE_VERSION, location: { $mid: 1, path: folder, scheme: "file" }, relativeLocation: name, metadata: { installedTimestamp: Date.now(), source: "resource" } };
  const kept = Array.isArray(registry) ? registry.find((entry) => entry.identifier?.id === BRIDGE_ID && entry.version === BRIDGE_VERSION) : undefined;
  if (!kept || registry.length !== others.length + 1) await writeFile(registryFile, JSON.stringify([...others, kept ?? ours]));
  const obsoleteFile = join(extensionsDir, ".obsolete");
  const obsolete = await readJson<Record<string, boolean>>(obsoleteFile, {});
  if (Object.keys(obsolete).some((key) => key.startsWith(`${BRIDGE_ID}-`))) {
    const rest = Object.fromEntries(Object.entries(obsolete).filter(([key]) => !key.startsWith(`${BRIDGE_ID}-`)));
    if (Object.keys(rest).length) await writeFile(obsoleteFile, JSON.stringify(rest));
    else await rm(obsoleteFile, { force: true });
  }
}

/** For tests: the extension's source. */
export const BRIDGE_SOURCE = EXTENSION;
