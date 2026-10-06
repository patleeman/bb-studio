// Response headers for an artifact's bytes. Artifacts are whatever an agent
// wrote, so every response except a real PDF carries a sandbox CSP: an HTML
// page or SVG opened from here runs in an opaque origin and can't reach BB.
// Chrome's PDF viewer refuses sandboxed documents, and a PDF can't run page
// scripts, so a PDF is served unsandboxed only when its bytes really are one.
import { SELECTION_MESSAGE, mimeFor } from "../shared";
import { versionType, type VersionRow } from "./store";

export const SANDBOX_CSP = "sandbox allow-scripts";

export function contentHeaders(
  version: Pick<VersionRow, "name" | "mime">,
  bytes: Uint8Array,
  options: { download?: boolean } = {},
): Record<string, string> {
  const type = versionType(version);
  const pdf = type === "pdf" && isPdf(bytes);
  const headers: Record<string, string> = {
    "content-type": contentType(type, version.mime.startsWith("image/") ? version.mime : mimeFor(version.name), pdf),
    "cache-control": "private, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
  };
  if (!pdf) headers["content-security-policy"] = SANDBOX_CSP;
  if (options.download) headers["content-disposition"] = attachment(version.name);
  return headers;
}

/** Only types the viewer shows natively keep their own mime type. */
function contentType(type: ReturnType<typeof versionType>, mime: string, pdf: boolean): string {
  if (type === "image" && /^image\/[\w.+-]+$/.test(mime)) return mime;
  if (type === "html") return "text/html; charset=utf-8";
  if (pdf) return "application/pdf";
  if (type === "markdown" || type === "code" || type === "text") return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

function isPdf(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && String.fromCharCode(...bytes.subarray(0, 5)) === "%PDF-";
}

function attachment(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

// Runs inside the sandboxed page and only reports what's selected, and where,
// when a selection is made, scrolled, or cleared. The viewer checks that the
// message came from its own frame.
const QUOTE_SCRIPT = `(() => {
  let shown = false;
  const post = () => {
    const selection = getSelection();
    const text = selection && !selection.isCollapsed ? String(selection).trim() : "";
    if (!text) {
      if (shown) parent.postMessage({ type: "${SELECTION_MESSAGE}", text: null }, "*");
      shown = false;
      return;
    }
    const r = selection.getRangeAt(0).getBoundingClientRect();
    shown = true;
    parent.postMessage({ type: "${SELECTION_MESSAGE}", text: text.slice(0, 20000), rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } }, "*");
  };
  let frame = 0;
  const soon = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(post); };
  addEventListener("mouseup", soon);
  addEventListener("keyup", soon);
  addEventListener("scroll", () => shown && soon(), true);
  document.addEventListener("selectionchange", () => { if (shown && getSelection()?.isCollapsed) soon(); });
})();`;

/** An HTML page with the quote script added, for the viewer's preview. */
export function withQuoteScript(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const html = Buffer.from(bytes).toString("utf8");
  const tag = `<script>${QUOTE_SCRIPT}</script>`;
  // Not toLowerCase().lastIndexOf: lowercasing can change the length ("İ"),
  // which would put the script at the wrong offset.
  let at = -1;
  for (const match of html.matchAll(/<\/body>/gi)) at = match.index;
  return new Uint8Array(Buffer.from(at < 0 ? html + tag : html.slice(0, at) + tag + html.slice(at), "utf8")) as Uint8Array<ArrayBuffer>;
}
