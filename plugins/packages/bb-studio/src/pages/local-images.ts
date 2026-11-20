// Images an agent puts in a page by local path, `![chart](/…/thread-storage/thr_…/chart.png)`.
//
// A path like that only works where something resolves it against the
// writer's thread, and stops working when the thread's storage is cleaned.
// So when an agent writes a page, each such image it may read (inside its
// thread's workspace or thread storage, the same rule as saving an artifact) is
// copied into the page's files and its src becomes the page-file URL, which
// the full editor, the chat card and the phone all load. Anything else stays
// as written, and the tool result names it.
//
// Pages saved before this keep their paths; `LOCAL_IMAGE_PATH` serves those
// through the threads linked to the page, or a placeholder.
import { posix } from "node:path";
import { isLocalImageSrc, PAGE_FILES_URL } from "../kit/pages-contract";
import { HTTP_ROOT } from "./constants";

/** Largest image a page write imports. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** Studio's route that resolves a local image path in a page saved before imports. */
export const LOCAL_IMAGE_PATH = "/pages/local-image";
export const LOCAL_IMAGE_URL = `${HTTP_ROOT}${LOCAL_IMAGE_PATH}`;

/** `![alt](src "title")`, with the src bare or in `<…>`. */
const IMAGE = /!\[((?:\\.|[^\]\\])*)\]\(\s*(?:<([^>\n]+)>|([^)\s]+))((?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*)\)/g;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

/**
 * The absolute local path an image src names, or null for anything else:
 * URLs, data URIs, root-relative app URLs (`/api/…`) and relative paths.
 */
export function localImagePath(src: string): string | null {
  let raw = src.trim();
  if (!isLocalImageSrc(raw)) return null;
  if (/^file:\/\//i.test(raw)) {
    try {
      raw = decodeURIComponent(new URL(raw).pathname);
    } catch {
      return null;
    }
  } else {
    try {
      raw = decodeURIComponent(raw);
    } catch { /* a stray % stays as written */ }
  }
  if (!raw.startsWith("/") || raw.includes("\0")) return null;
  return posix.normalize(raw);
}

/** Calls `visit` for each image outside code fences; its return value replaces the src. */
function eachImage(markdown: string, visit: (src: string) => string | null): string {
  let fence: string | null = null;
  return markdown.split("\n").map((line) => {
    const open = FENCE.exec(line)?.[1];
    if (fence) {
      if (open && open[0] === fence[0] && open.length >= fence.length && line.trim() === open) fence = null;
      return line;
    }
    if (open) {
      fence = open;
      return line;
    }
    if (!line.includes("![")) return line;
    return line.replace(IMAGE, (whole, alt: string, angled: string | undefined, bare: string | undefined, title: string) => {
      const next = visit(angled ?? bare ?? "");
      return next === null ? whole : `![${alt}](${next}${title})`;
    });
  }).join("\n");
}

/** The distinct local image srcs in `markdown`, as written. */
export function localImageSrcs(markdown: string): string[] {
  const found = new Set<string>();
  eachImage(markdown, (src) => {
    if (localImagePath(src)) found.add(src);
    return null;
  });
  return [...found];
}

/** `markdown` with each image src in `urls` replaced. */
export function replaceImageSrcs(markdown: string, urls: ReadonlyMap<string, string>): string {
  if (!urls.size) return markdown;
  return eachImage(markdown, (src) => urls.get(src) ?? null);
}

export type ImageMime = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

/** The image type its bytes say, for the types pages import; null otherwise (SVG included). */
export function sniffImage(bytes: Uint8Array): ImageMime | null {
  const at = (offset: number, ...values: number[]) => values.every((value, index) => bytes[offset + index] === value);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x47, 0x49, 0x46, 0x38) && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return "image/gif";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return null;
}

const IMAGE_NAME = /\.(png|jpe?g|gif|webp)$/i;

/** What reading one image gave: its bytes, or why it can't be used. */
export type ImageRead = { bytes: Uint8Array; size: number } | { error: string };

/**
 * Reads a local image the writer may read. `size` is the file's size, so a
 * reader can refuse a large file without the caller decoding it.
 */
export type ImageReader = (path: string) => Promise<ImageRead>;

export interface LoadedImage {
  src: string;
  name: string;
  mime: ImageMime;
  bytes: Uint8Array;
}

export interface SkippedImage {
  src: string;
  reason: string;
}

export interface LoadedImages {
  loaded: LoadedImage[];
  skipped: SkippedImage[];
}

/** Reads every local image in `markdowns` that may go into a page. */
export async function loadLocalImages(markdowns: readonly string[], read: ImageReader): Promise<LoadedImages> {
  const loaded: LoadedImage[] = [];
  const skipped: SkippedImage[] = [];
  for (const src of new Set(markdowns.flatMap(localImageSrcs))) {
    const result = await loadLocalImage(src, localImagePath(src)!, read);
    if ("reason" in result) skipped.push(result);
    else loaded.push(result);
  }
  return { loaded, skipped };
}

/** Reads one local image at `path` (named `src` in the page), checking its name, size and bytes. */
export async function loadLocalImage(src: string, path: string, read: ImageReader): Promise<LoadedImage | SkippedImage> {
  const name = posix.basename(path);
  if (/\.svg$/i.test(name)) return { src, reason: "SVG images aren't imported; save it as an artifact and embed that, or use a PNG" };
  if (!IMAGE_NAME.test(name)) return { src, reason: "only PNG, JPEG, GIF and WebP images are imported" };
  let result: ImageRead;
  try {
    result = await read(path);
  } catch (error) {
    result = { error: error instanceof Error ? error.message : String(error) };
  }
  if ("error" in result) return { src, reason: result.error };
  if (result.size > MAX_IMAGE_BYTES || result.bytes.byteLength > MAX_IMAGE_BYTES) {
    return { src, reason: `it is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB` };
  }
  const mime = sniffImage(result.bytes);
  if (!mime) return { src, reason: "the file isn't a PNG, JPEG, GIF or WebP image" };
  return { src, name, mime, bytes: result.bytes };
}

/**
 * Stores loaded images as files of `pageId` and returns the src → page-file
 * URL map to rewrite its Markdown with.
 */
export function storeImages(
  pageId: string,
  images: readonly LoadedImage[],
  addFile: (pageId: string, name: string, mime: string, data: Uint8Array) => string,
): Map<string, string> {
  return new Map(images.map((image) => [image.src, `${PAGE_FILES_URL}?id=${addFile(pageId, image.name, image.mime, image.bytes)}`]));
}

/** The line a tool result adds about images it couldn't import, or "" when there were none. */
export function skippedNote(skipped: readonly SkippedImage[]): string {
  if (!skipped.length) return "";
  const lines = skipped.map((image) => `- ${image.src}: ${image.reason}.`);
  return [
    `${skipped.length === 1 ? "One image was" : `${skipped.length} images were`} not imported into the page and may not show:`,
    ...lines,
    "",
    "Only images in this thread's workspace or thread storage are imported. Or save the image as an artifact and use an ```embed {\"kind\":\"artifact\"} block.",
  ].join("\n");
}

/** A small "Image not available" picture for a local image that can't be shown. */
export function unavailableSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="72" viewBox="0 0 360 72"><rect x="0.5" y="0.5" width="359" height="71" rx="8" fill="#8881" stroke="#8886"/><text x="180" y="41" text-anchor="middle" font-family="-apple-system, system-ui, sans-serif" font-size="14" fill="#888">Image not available</text></svg>`;
}
