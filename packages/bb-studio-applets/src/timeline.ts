// A thread's recent conversation in a small, stable shape for applets:
// user and assistant messages, plus one line per tool call. Timeline rows are
// read defensively: they're the SDK's rows, nested under turns.
import type { TimelineItem } from "../contract";

type Row = Record<string, unknown>;

const isRow = (value: unknown): value is Row => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === "string" && value.length ? value : null);

const MAX_TEXT = 20_000;
const MAX_LABEL = 160;

function* walk(rows: unknown): Generator<Row> {
  if (!Array.isArray(rows)) return;
  for (const row of rows) {
    if (!isRow(row)) continue;
    if (row.kind === "turn") yield* walk(row.children);
    else yield row;
  }
}

function workLabel(row: Row): string {
  const label =
    str(row.title) ??
    str(row.summary) ??
    (str(row.command) ? `$ ${str(row.command)}` : null) ??
    str(row.toolName) ??
    str(row.path) ??
    str(row.query) ??
    str(row.workKind) ??
    "Working";
  return label.replace(/\s+/g, " ").slice(0, MAX_LABEL);
}

export function timelineItems(rows: unknown, limit: number): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const row of walk(rows)) {
    const id = str(row.id);
    if (!id) continue;
    const status = str(row.status);
    if (row.kind === "conversation") {
      const role = row.role === "user" ? "user" : row.role === "assistant" ? "assistant" : null;
      const text = str(row.text);
      // Agent-only context the user never typed stays out.
      if (!role || !text || row.visibility === "agent-only") continue;
      items.push({ id, type: role, text: text.slice(0, MAX_TEXT), status, createdAt: typeof row.createdAt === "number" ? row.createdAt : null });
    } else if (row.kind === "work") {
      items.push({ id, type: "tool", text: workLabel(row), status, createdAt: typeof row.createdAt === "number" ? row.createdAt : null });
    }
  }
  return items.slice(-limit);
}
