// Reads a page's local images through a thread, with the rules saving an artifact
// uses: only files inside the thread's workspace or thread storage, read with
// that root set so the host refuses symlinks that lead out of it.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { errorMessage } from "../kit/format";
import { resolveSource, threadRoots, type SourceRoot } from "../kit/server/index";
import { serveBytes } from "../kit/server/bytes";
import { loadLocalImage, localImagePath, localImageSrcs, MAX_IMAGE_BYTES, unavailableSvg, type ImageRead, type ImageReader } from "./local-images";

type Sdk = Pick<BbPluginApi, "sdk">;

/** Reads `path` if it is inside one of `roots`. */
export async function readFromRoots(bb: Sdk, roots: readonly SourceRoot[], path: string): Promise<ImageRead> {
  const source = resolveSource(path, roots);
  if ("error" in source) return { error: `it is outside this thread's workspace and thread storage` };
  try {
    const file = await bb.sdk.files.read({ hostId: source.root.hostId, rootPath: source.root.path, path: source.path });
    if (file.sizeBytes > MAX_IMAGE_BYTES) return { bytes: new Uint8Array(), size: file.sizeBytes };
    const bytes = file.contentEncoding === "base64" ? Buffer.from(file.content, "base64") : Buffer.from(file.content, "utf8");
    return { bytes: new Uint8Array(bytes), size: file.sizeBytes };
  } catch (error) {
    const text = errorMessage(error);
    return { error: /ENOENT|not found|no such file|does not exist/i.test(text) ? "the file was not found" : `it could not be read (${text})` };
  }
}

/** An `ImageReader` for one thread, finding its roots once. */
export function threadImageReader(bb: Sdk, threadId: string): ImageReader {
  let roots: Promise<SourceRoot[]> | null = null;
  return async (path) => {
    roots ??= threadRoots(bb, threadId).then((found) => found.roots, () => []);
    return readFromRoots(bb, await roots, path);
  };
}

/** A thread's project and the folders its images may come from. */
export interface ThreadFolders {
  projectId: string | null;
  roots: SourceRoot[];
}

/**
 * The threads that could have written a page's local paths: those that made
 * or edited it. Chat, checklist and notes threads only talk about a page.
 */
export function writerThreads(links: readonly { threadId: string; role: string; state: string }[]): string[] {
  return [...new Set(links.filter((link) => (link.role === "created" || link.role === "edited") && link.state !== "deleted").map((link) => link.threadId))];
}

const FOLDERS_TTL_MS = 60_000;
const MISS_TTL_MS = 30_000;
const MAX_CACHED = 500;
const MAX_THREADS = 10;

/**
 * Serves local image paths in pages saved before imports: the image, if the
 * page's Markdown names that path and a thread that made or edited the page,
 * in the page's project, can read it; otherwise an "Image not available"
 * picture. Each thread's folders are kept for a minute, and a recent miss for
 * half that, so a page full of old paths, or a caller in a loop, doesn't cost
 * a host round trip per thread per request.
 */
export class OlderPageImages {
  private readonly folders = new Map<string, { at: number; value: Promise<ThreadFolders | null> }>();
  private readonly misses = new Map<string, number>();

  constructor(private readonly deps: {
    folders(threadId: string): Promise<ThreadFolders>;
    read(roots: readonly SourceRoot[], path: string): Promise<ImageRead>;
    now?: () => number;
  }) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private threadFolders(threadId: string): Promise<ThreadFolders | null> {
    const now = this.now();
    const cached = this.folders.get(threadId);
    if (cached && now - cached.at < FOLDERS_TTL_MS) return cached.value;
    const value = this.deps.folders(threadId).catch(() => null);
    remember(this.folders, threadId, { at: now, value });
    return value;
  }

  async serve(input: {
    pageId: string;
    /** The page's project; null for a global page, which any project's writer may have written. */
    projectId: string | null;
    path: string;
    /** The page's Markdown, or null when there's no such page. */
    markdown: string | null;
    /** From `writerThreads`. */
    threads: readonly string[];
  }): Promise<Response> {
    const path = localImagePath(input.path);
    const key = `${input.pageId}\n${path}`;
    const missed = this.misses.get(key);
    const fresh = missed !== undefined && this.now() - missed < MISS_TTL_MS;
    if (path && !fresh && input.markdown !== null && localImageSrcs(input.markdown).some((src) => localImagePath(src) === path)) {
      for (const threadId of [...new Set(input.threads)].slice(0, MAX_THREADS)) {
        const folders = await this.threadFolders(threadId);
        if (!folders?.roots.length) continue;
        if (input.projectId !== null && folders.projectId !== input.projectId) continue;
        const image = await loadLocalImage(path, path, (file) => this.deps.read(folders.roots, file));
        if (!("reason" in image)) {
          this.misses.delete(key);
          return serveBytes(new Uint8Array(image.bytes), { "content-type": image.mime, "cache-control": "private, max-age=300", "content-security-policy": "sandbox" });
        }
      }
    }
    if (path && !fresh) remember(this.misses, key, this.now());
    return new Response(unavailableSvg(), {
      headers: { "content-type": "image/svg+xml", "cache-control": "no-store", "x-content-type-options": "nosniff", "content-security-policy": "sandbox", "x-bb-image": "unavailable" },
    });
  }
}

/** Sets a key as the newest, dropping the oldest past `MAX_CACHED`. */
function remember<V>(map: Map<string, V>, key: string, value: V): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > MAX_CACHED) map.delete(map.keys().next().value!);
}
