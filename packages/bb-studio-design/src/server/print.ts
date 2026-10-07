// Export to PDF: a page that holds a screen once per step (a deck's slides),
// each on its own printed page at the frame's exact size. The app loads it in
// a hidden frame; once every screen has loaded it opens the print dialog,
// where Save as PDF makes the file. Screens stay in their own sandboxed
// frames, so this page runs only its own script.

export type PrintFrame = { url: string; label: string };

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** Time for web fonts and late layout after every frame has loaded. */
export const PRINT_SETTLE_MS = 800;

export function printPage(input: { title: string; width: number; height: number; frames: PrintFrame[]; nonce: string }): string {
  const { width, height } = input;
  const pages = input.frames
    .map((frame) => `<section class="page"><iframe title="${escapeHtml(frame.label)}" src="${escapeHtml(frame.url)}" sandbox="allow-scripts" width="${width}" height="${height}"></iframe></section>`)
    .join("\n");
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(input.title)}</title>
<style>
  @page { size: ${width}px ${height}px; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  .page { width: ${width}px; height: ${height}px; overflow: hidden; break-after: page; page-break-after: always; }
  .page:last-child { break-after: auto; page-break-after: auto; }
  iframe { display: block; border: 0; width: ${width}px; height: ${height}px; }
</style></head>
<body>
${pages}
<script nonce="${input.nonce}">
(() => {
  const frames = Array.from(document.querySelectorAll("iframe"));
  let waiting = frames.length;
  const done = () => parent.postMessage({ bbDesignPrint: "done" }, "*");
  const ready = () => setTimeout(() => {
    addEventListener("afterprint", done, { once: true });
    try { print(); } catch { done(); }
  }, ${PRINT_SETTLE_MS});
  if (!waiting) ready();
  for (const frame of frames) frame.addEventListener("load", () => { if (--waiting === 0) ready(); }, { once: true });
})();
</script>
</body></html>`;
}

/** Our page and frames of our own screen route; nothing else. */
export function printCsp(nonce: string): string {
  return ["default-src 'none'", `script-src 'nonce-${nonce}'`, "style-src 'unsafe-inline'", "frame-src 'self'"].join("; ");
}
