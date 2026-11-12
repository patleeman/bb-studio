// "Show in BB" opens a file in BB's own preview. VS Code is the opener for
// code files, so that one open has to pass it by: the path is noted here for
// a moment, and the opener (src/file-opener.tsx) leaves it to BB.
const WINDOW_MS = 5000;
const wanted = new Map<string, number>();

/** BB's preview is about to be opened for `path`. */
export function showBbPreview(path: string, now = Date.now()): void {
  for (const [each, at] of wanted) if (now - at > WINDOW_MS) wanted.delete(each);
  wanted.set(path, now);
}

const sameFile = (a: string, b: string) => a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);

/** Whether the open of `path` now under way asked for BB's preview. BB may name the file by a longer or shorter path. */
export function wantsBbPreview(path: string, now = Date.now()): boolean {
  for (const [each, at] of wanted) if (now - at <= WINDOW_MS && sameFile(each, path)) return true;
  return false;
}
