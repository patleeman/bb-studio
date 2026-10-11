// Two schemes. `applet://<id>/<path>` serves an applet's own files, with a
// strict CSP. `studio://kit/<file>` serves the shared UI kit: React, the
// Studio kit components, Tailwind's browser build, and BB's live stylesheet
// and theme, so applets look like BB without a build step.
import { protocol } from "electron";
import { readFile } from "node:fs/promises";
import { extname, join, sep } from "node:path";
import { APPLET_ID } from "../../../../packages/bb-studio-applets/src/manifest";
import { bbStylesheet, bbTheme } from "./bb";
import { appletDir, resolveInside } from "./paths";

export const CSP = [
  "default-src 'self' studio:",
  "script-src 'self' studio:",
  "style-src 'self' studio: 'unsafe-inline'",
  "img-src 'self' studio: data: blob: https:",
  "font-src 'self' studio: data:",
  "media-src 'self' blob: https:",
  "connect-src 'self' studio: https:",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
].join("; ");

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: "applet", privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true, corsEnabled: true } },
    { scheme: "studio", privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true, corsEnabled: true } },
  ]);
}

function notFound(): Response {
  return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
}

async function serveFile(path: string, headers: Record<string, string> = {}): Promise<Response> {
  try {
    const body = await readFile(path);
    return new Response(body, { headers: { "content-type": TYPES[extname(path).toLowerCase()] ?? "application/octet-stream", ...headers } });
  } catch {
    return notFound();
  }
}

export function handleSchemes(kitDir: string): void {
  protocol.handle("applet", (request) => {
    const url = new URL(request.url);
    if (!APPLET_ID.test(url.hostname)) return notFound();
    const base = appletDir(url.hostname);
    const path = resolveInside(base, url.pathname || "/index.html");
    // An applet's data/ folder is for studio.fs, not for loading as pages.
    if (!path || path.startsWith(join(base, "data") + sep)) return notFound();
    return serveFile(path, { "content-security-policy": CSP, "x-content-type-options": "nosniff" });
  });

  protocol.handle("studio", async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== "kit") return notFound();
    const name = url.pathname.replace(/^\/+/, "");
    // Applet pages load the kit as module scripts from another scheme.
    const cors = { "access-control-allow-origin": "*" };
    const css = { "content-type": "text/css; charset=utf-8", "cache-control": "no-store", ...cors };
    if (name === "bb.css") return new Response(await bbStylesheet(), { headers: css });
    if (name === "theme.css") return new Response(await bbTheme(), { headers: css });
    const path = resolveInside(kitDir, name);
    return path ? serveFile(path, cors) : notFound();
  });
}
