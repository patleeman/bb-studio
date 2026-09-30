// Response headers for an artifact's bytes. Artifacts are whatever an agent
// wrote, so every response except a real PDF carries a sandbox CSP: an HTML
// page or SVG opened from here runs in an opaque origin and can't reach BB.
// Chrome's PDF viewer refuses sandboxed documents, and a PDF can't run page
// scripts, so a PDF is served unsandboxed only when its bytes really are one.
import { mimeFor } from "../shared";
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
