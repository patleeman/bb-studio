// Reads a page's local images through a thread, with the rules artifacts_save
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

/**
 * The response for a local image path in a page saved before imports: the
 * image, if the page's Markdown names that path and one of the page's threads
 * (the ones that made, edited or chatted about it) can read it; otherwise an
 * "Image not available" picture.
 */
export async function pageLocalImage(input: {
  path: string;
  /** The page's Markdown, or null when there's no such page. */
  markdown: string | null;
  threads: () => readonly string[];
  reader: (threadId: string) => ImageReader;
}): Promise<Response> {
  const path = localImagePath(input.path);
  const named = path !== null && input.markdown !== null && localImageSrcs(input.markdown).some((src) => localImagePath(src) === path);
  if (named) {
    for (const threadId of [...new Set(input.threads())].slice(0, 10)) {
      const image = await loadLocalImage(path, path, input.reader(threadId));
      if (!("reason" in image)) {
        return serveBytes(new Uint8Array(image.bytes), { "content-type": image.mime, "cache-control": "private, max-age=300", "content-security-policy": "sandbox" });
      }
    }
  }
  return new Response(unavailableSvg(), {
    headers: { "content-type": "image/svg+xml", "cache-control": "no-store", "x-content-type-options": "nosniff", "content-security-policy": "sandbox", "x-bb-image": "unavailable" },
  });
}
