// What an agent is doing, read from its thread's events: which file it's
// reading (and which lines, when it says), which file it changed and what it
// added, and when its turn starts and ends. Claude Code reads with its Read
// tool (fileRead items); Codex reads through the shell, so plain read
// commands (sed -n, cat, head, nl) are understood too. Anything else is
// left out.
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export type Activity =
  | { kind: "read"; path: string; startLine?: number; endLine?: number }
  | { kind: "edit"; path: string; added: string[] }
  | { kind: "turn"; state: "working" | "done" };

type Event = { type: string; data?: { item?: Record<string, unknown> } | Record<string, unknown> };

/** The lines a diff adds, without its file headers. */
export function addedLines(diff: string): string[] {
  const lines = diff.split("\n");
  let at = 0;
  while (at < lines.length && (lines[at]!.startsWith("--- ") || lines[at]!.startsWith("+++ "))) at += 1;
  return lines.slice(at).filter((line) => line.startsWith("+")).map((line) => line.slice(1));
}

/** `/bin/zsh -lc "cmd"` → `cmd`. */
function unwrap(command: string): string {
  const match = /^\S*\b(?:ba|z)?sh\s+-l?c\s+(["'])([\s\S]*)\1\s*$/.exec(command.trim());
  return match ? match[2]!.replace(/\\(["'\\$`])/g, "$1") : command.trim();
}

const word = String.raw`(?:'[^']*'|"[^"]*"|[^\s'";|&<>]+)`;
const unquote = (value: string) => value.replace(/^(['"])(.*)\1$/, "$2");

/** A shell command split on ; && || outside quotes. */
function segments(command: string): string[] {
  const parts: string[] = [];
  let quote: string | null = null;
  let current = "";
  for (let at = 0; at < command.length; at++) {
    const char = command[at]!;
    if (quote) { if (char === quote) quote = null; current += char; continue; }
    if (char === "'" || char === '"') { quote = char; current += char; continue; }
    const two = command.slice(at, at + 2);
    if (char === ";" || two === "&&" || two === "||") {
      parts.push(current.trim());
      current = "";
      if (char !== ";") at += 1;
      continue;
    }
    current += char;
  }
  parts.push(current.trim());
  return parts.filter(Boolean);
}

type Read = { file: string; startLine?: number; endLine?: number };

/** Plain reads in one simple command: the files and, when it says, the lines. */
function readsIn(text: string): Read[] {
  // Redirections, substitutions and background jobs: not a plain read.
  if (/[><`]|\$\(|&$/.test(text.replace(/'[^']*'/g, "''"))) return [];
  let match = new RegExp(String.raw`^sed\s+-n\s+'?(\d+),(\d+)p'?\s+(${word})$`).exec(text);
  if (match) return [{ file: unquote(match[3]!), startLine: Number(match[1]), endLine: Number(match[2]) }];
  match = new RegExp(String.raw`^nl\s+(?:-\w+\s+)*(${word})\s*\|\s*sed\s+-n\s+'?(\d+),(\d+)p'?$`).exec(text);
  if (match) return [{ file: unquote(match[1]!), startLine: Number(match[2]), endLine: Number(match[3]) }];
  // A read trimmed by head or tail: head keeps its first lines; with tail,
  // which lines depends on the file's length, so only the file counts.
  const trimmed = /^(.*\S)\s*\|\s*(head|tail)(?:\s+-n)?\s*-?(\d+)?\s*$/.exec(text);
  if (trimmed && !trimmed[1]!.includes("|")) {
    const reads = readsIn(trimmed[1]!);
    if (reads.length !== 1) return [];
    const [read] = reads as [Read];
    if (trimmed[2] === "tail") return [{ file: read.file }];
    const count = trimmed[3] ? Number(trimmed[3]) : 10;
    const start = read.startLine ?? 1;
    return [{ file: read.file, startLine: start, endLine: read.endLine !== undefined ? Math.min(read.endLine, start + count - 1) : start + count - 1 }];
  }
  if (text.includes("|")) return [];
  match = new RegExp(String.raw`^head\s+(?:-n\s*)?-?(\d+)\s+(${word})$`).exec(text);
  if (match) return [{ file: unquote(match[2]!), startLine: 1, endLine: Number(match[1]) }];
  match = new RegExp(String.raw`^(?:cat|nl)((?:\s+-\w+)*)((?:\s+${word})+)$`).exec(text);
  if (match) return (match[2]!.match(new RegExp(word, "g")) ?? []).map((file) => ({ file: unquote(file) }));
  return [];
}

/** Every plain read in a command, however it's wrapped and joined. */
function readsOf(command: string): Read[] {
  return segments(unwrap(command)).flatMap(readsIn);
}

/** A file's full path: ~ is the home folder; other relative paths start where the command ran. */
const at = (from: string | null, file: string) => {
  // Always normalized (no ..), before anything checks which folder it's in.
  if (file === "~" || file.startsWith("~/")) return resolve(join(homedir(), file.slice(2)));
  return isAbsolute(file) ? resolve(file) : from ? resolve(from, file) : null;
};

/**
 * The first activity in one thread event, or null. `base` is the thread's
 * working folder, for relative paths that don't say where they ran.
 */
export function activityFrom(event: Event, base: string | null): Activity | null {
  return activitiesFrom(event, base)[0] ?? null;
}

/** Every activity in one event: one command can read several files, one change touch several. */
export function activitiesFrom(event: Event, base: string | null = null): Activity[] {
  if (event.type === "turn/started") return [{ kind: "turn", state: "working" }];
  if (event.type === "turn/completed") return [{ kind: "turn", state: "done" }];
  const item = (event.data as { item?: Record<string, unknown> } | undefined)?.item;
  if (!item) return [];
  if (item.type === "fileRead" && event.type === "item/started" && typeof item.path === "string") return [{ kind: "read", path: resolve(item.path) }];
  if (item.type === "commandExecution" && event.type === "item/started" && typeof item.command === "string") {
    const from = typeof item.cwd === "string" && item.cwd ? item.cwd : base;
    return readsOf(item.command).flatMap((read) => {
      const path = at(from, read.file);
      return path ? [{ kind: "read" as const, path, ...(read.startLine ? { startLine: read.startLine, endLine: read.endLine! } : {}) }] : [];
    });
  }
  if (item.type === "fileChange" && event.type === "item/completed" && Array.isArray(item.changes)) {
    return (item.changes as { path?: unknown; kind?: unknown; diff?: unknown }[])
      .filter((each) => typeof each.path === "string" && each.kind !== "delete")
      .flatMap((each) => {
        const path = at(base, each.path as string);
        return path ? [{ kind: "edit" as const, path, added: typeof each.diff === "string" ? addedLines(each.diff) : [] }] : [];
      });
  }
  // Its live edits in the user's editor (code_edit) count as edits too.
  if (item.type === "toolCall" && item.tool === "code_edit" && event.type === "item/completed" && item.status !== "failed") {
    const args = item.arguments as { path?: unknown; edits?: { newText?: unknown }[] } | undefined;
    const path = typeof args?.path === "string" ? at(base, args.path) : null;
    if (!path) return [];
    const added = (args?.edits ?? []).flatMap((edit) => (typeof edit.newText === "string" ? edit.newText.split("\n") : []));
    return [{ kind: "edit", path, added }];
  }
  return [];
}
