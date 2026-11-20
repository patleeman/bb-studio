// `bb studio strands <thread>`: a conversation's strands, their live states,
// and how its newest messages were sorted, to check the sorting by eye.
import { parseCliArgs } from "../cli-args";
import { relativeTime } from "../kit/format";
import type { StrandItemView, StrandList, StrandView } from "./contract";

export const STRANDS_USAGE = "bb studio strands [<thread>|main] [--items <n>] [--sort] [--json]";

export interface StrandsCliDeps {
  /** A thread id, "main" or nothing (the caller's Bot's Main) to the conversation's id. */
  resolve(ref: string | null): Promise<string | null>;
  list(threadId: string): Promise<StrandList>;
  items(threadId: string, limit: number): StrandItemView[];
  /** Sorts what's new now (backfilling first when it never ran). */
  sort(threadId: string): Promise<void>;
  now?(): number;
}

const pad = (text: string, width: number) => (text.length >= width ? `${text.slice(0, width - 1)}… ` : text.padEnd(width + 1));
const oneLine = (text: string | null, max: number) => {
  const line = (text ?? "").replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

function strandLine(strand: StrandView, now: number): string {
  const flags = [strand.named ? "" : "unnamed", strand.pinned ? "pinned" : "", strand.origin === "task" && strand.taskId ? `task ${strand.taskId}` : "", strand.unsure ? `${strand.unsure} unsure` : ""].filter(Boolean).join(", ");
  return `${pad(strand.state, 11)}${pad(strand.title, 32)}${String(strand.messages).padStart(4)}  ${pad(strand.lastAt ? relativeTime(strand.lastAt, now) : "-", 10)}${strand.detail ? `— ${oneLine(strand.detail, 60)} ` : ""}${flags ? `(${flags})` : ""}`.trimEnd();
}

export function formatStrands(list: StrandList, items: readonly StrandItemView[], now: number): string {
  const lines: string[] = [];
  const backfill = list.backfill.done ? `backfilled ${list.backfill.sorted} of ${list.backfill.messages} messages${list.backfill.at ? ` ${relativeTime(list.backfill.at, now)}` : ""}` : "not backfilled yet";
  lines.push(`${list.threadId} · ${list.enabled ? "strands on" : "strands off (phase 1 sorts a Bot's Main only)"} · ${backfill} · Jev calls today ${list.jevCallsToday}/${list.jevDailyCap}${list.sortingTurn ? " · a running turn isn't sorted yet" : ""}`);
  if (!list.strands.length && !list.earlier.length) {
    lines.push("No strands yet.");
  } else {
    lines.push("", `${pad("STATE", 11)}${pad("STRAND", 32)}MSGS  LAST`);
    for (const strand of list.strands) lines.push(strandLine(strand, now));
    if (list.earlier.length) {
      lines.push("", `Earlier (${list.earlier.length}):`);
      for (const strand of list.earlier) lines.push(strandLine(strand, now));
    }
  }
  if (items.length) {
    const titles = new Map([...list.strands, ...list.earlier].map((strand) => [strand.id, strand.title]));
    lines.push("", `Newest ${items.length} sorted (newest first):`, `${pad("SEQ", 8)}${pad("KIND", 7)}${pad("STRAND", 26)}${pad("BY", 9)}${pad("CONF", 5)}LINE`);
    for (const item of items) {
      const strand = item.strandId ? titles.get(item.strandId) ?? item.strandId : "(none)";
      const conf = item.confidence === null ? "-" : item.confidence.toFixed(2);
      lines.push(`${pad(String(item.seq), 8)}${pad(item.kind, 7)}${pad(strand, 26)}${pad(item.by + (item.unsure ? "?" : ""), 9)}${pad(conf, 5)}${oneLine(item.line, 70)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export async function runStrandsCli(argv: readonly string[], deps: StrandsCliDeps): Promise<{ exitCode: number; stdout?: string; stderr?: string }> {
  const parsed = parseCliArgs(argv, { flags: ["--json", "--sort"], options: ["--items"] });
  if (!parsed.ok || parsed.positional.length > 1) return { exitCode: 1, stderr: `usage: ${STRANDS_USAGE}\n${parsed.ok ? "" : `${parsed.error}\n`}` };
  const limit = parsed.options.has("--items") ? Number(parsed.options.get("--items")) : 40;
  if (!Number.isInteger(limit) || limit < 0 || limit > 2000) return { exitCode: 1, stderr: "--items takes a number from 0 to 2000.\n" };
  const threadId = await deps.resolve(parsed.positional[0] ?? null);
  if (!threadId) return { exitCode: 1, stderr: `No conversation found for ${parsed.positional[0] ?? "this thread's Bot"}. Pass a thread id or "main".\n` };
  if (parsed.flags.has("--sort")) await deps.sort(threadId);
  const list = await deps.list(threadId);
  const items = limit ? deps.items(threadId, limit) : [];
  if (parsed.flags.has("--json")) return { exitCode: 0, stdout: `${JSON.stringify({ ...list, items }, null, 2)}\n` };
  return { exitCode: 0, stdout: formatStrands(list, items, deps.now?.() ?? Date.now()) };
}
