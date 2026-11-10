const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/mu;

export function firstChangedLine(patch: string | undefined): number | null {
  if (patch === undefined) return null;
  const hunk = HUNK_HEADER.exec(patch);
  if (hunk === null) return null;
  const start = Number(hunk[1]);
  const body = patch.slice(hunk.index).split("\n").slice(1);
  let line = start;
  for (const row of body) {
    if (row.startsWith("@@")) break;
    if (row.startsWith("+")) return Math.max(1, line);
    if (!row.startsWith("-") && !row.startsWith("\\")) line += 1;
  }
  return Math.max(1, start);
}
