// The files one reply produced, read from the thread's history: images it
// generated and files it created or changed. "Save to Studio" offers these.

export interface TurnFile {
  path: string;
  kind: "image" | "created" | "changed";
}

/** The slice of a thread event row this reads. */
export interface EventRow {
  seq: number;
  type: string;
  data: unknown;
}

type Item = { type?: unknown; path?: unknown; status?: unknown; changes?: unknown };

/**
 * Files from the `item/completed` rows of the turn that ends at `endSeq`.
 * `rows` are newest first; the turn starts after the nearest
 * `client/turn/requested` row. Deleted files are dropped, and a file that's
 * both created and changed counts as created.
 */
export function turnFiles(rows: readonly EventRow[], endSeq: number): TurnFile[] {
  // `at` orders files as the reply made them: by row, then within a row.
  const found = new Map<string, TurnFile & { at: [number, number] }>();
  const add = (path: string, kind: TurnFile["kind"], at: [number, number]) => {
    const current = found.get(path);
    if (!current) found.set(path, { path, kind, at });
    else if (rank(kind) > rank(current.kind)) current.kind = kind;
  };
  const deleted = new Set<string>();

  for (const row of rows) {
    if (row.seq > endSeq) continue;
    if (row.type === "client/turn/requested") break;
    if (row.type !== "item/completed") continue;
    const item = ((row.data as { item?: Item } | null)?.item ?? {}) as Item;
    if (item.type === "imageGeneration" && typeof item.path === "string" && item.path && item.status !== "failed") {
      add(item.path, "image", [row.seq, 0]);
    }
    if (item.type === "fileChange" && Array.isArray(item.changes) && item.status !== "failed") {
      for (const [index, change] of (item.changes as { path?: unknown; kind?: unknown; movePath?: unknown }[]).entries()) {
        const path = typeof change.movePath === "string" && change.movePath ? change.movePath : change.path;
        if (typeof path !== "string" || !path) continue;
        // Rows are newest first, so a later delete is seen before the write.
        if (change.kind === "delete") {
          if (!found.has(path)) deleted.add(path);
          continue;
        }
        if (deleted.has(path)) continue;
        add(path, change.kind === "add" ? "created" : "changed", [row.seq, index]);
      }
    }
  }
  // Oldest first reads like the reply did.
  return [...found.values()]
    .sort((a, b) => a.at[0] - b.at[0] || a.at[1] - b.at[1])
    .map(({ path, kind }) => ({ path, kind }));
}

function rank(kind: TurnFile["kind"]): number {
  return kind === "image" ? 3 : kind === "created" ? 2 : 1;
}

/** BB returns at most this many events per request. */
export const EVENT_PAGE = 100;
/** Stop reading history after this many pages (2,000 events). */
const MAX_PAGES = 20;

/**
 * The rows `turnFiles` needs for the turn ending at `endSeq`, newest first:
 * pages back from `endSeq` until the turn's `client/turn/requested` row.
 * `fetchPage` returns up to `EVENT_PAGE` rows before `beforeSeq`, newest first.
 */
export async function turnRows(
  fetchPage: (beforeSeq: number | null) => Promise<EventRow[]>,
  endSeq: number | null,
): Promise<EventRow[]> {
  const rows: EventRow[] = [];
  let beforeSeq = endSeq === null ? null : endSeq + 1;
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await fetchPage(beforeSeq);
    rows.push(...batch);
    if (batch.length < EVENT_PAGE || batch.some((row) => row.type === "client/turn/requested")) break;
    beforeSeq = Math.min(...batch.map((row) => row.seq));
  }
  return rows;
}
