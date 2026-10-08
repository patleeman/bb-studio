// Wires the backup service into Studio: the Setup page's RPCs, the download
// route and the folders they use under Studio's plugin data directory.
import { createHash, randomBytes, randomInt } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { backupContract, UPLOAD_CHUNK_BYTES, type RestoreResult } from "../backup-contract";
import { formatBackup, formatRestore, restoreFailed, type BackupService, type RestoreSummary } from "./service";

/** Backups made from the Setup page; the newest few are kept for download. */
const KEEP_DOWNLOADS = 3;
/** The largest backup the Setup page accepts; the format holds at most 4 GiB. */
const MAX_UPLOAD = 4 * 1024 ** 3;
/** Uploads not restored within a day are deleted. */
const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

/** Down to the millisecond plus four random digits, so two backups never share a name. Digits only: the download route matches `[0-9T-]+`. */
export function backupFileName(now = new Date(), random = randomInt(0, 10_000)): string {
  return `bb-studio-backup-${now.toISOString().slice(0, 23).replace(/[:.]/g, "-")}-${String(random).padStart(4, "0")}.zip`;
}

/** SHA-256 of a file, streamed. */
async function fileHash(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export function restoreResult(summary: RestoreSummary): RestoreResult {
  return { ...summary, text: formatRestore(summary), failed: restoreFailed(summary) };
}

export function registerBackup(bb: Pick<BbPluginApi, "rpc" | "http" | "log" | "onDispose">, service: BackupService, studioDir: string): void {
  const downloads = join(studioDir, "backups");
  const uploads = join(studioDir, "backup-uploads");
  const uploadPath = (id: string) => join(uploads, `${id}.zip`);
  /** The content hash each upload had when its dry run was shown; a real restore needs the same file. */
  const checked = new Map<string, string>();

  // Leftovers from a crash or an abandoned upload.
  void (async () => {
    await service.cleanup();
    const now = Date.now();
    for (const name of await readdir(uploads).catch(() => [] as string[])) {
      const info = await stat(join(uploads, name)).catch(() => null);
      if (info && now - info.mtimeMs > UPLOAD_TTL_MS) await rm(join(uploads, name), { force: true });
    }
  })().catch((error) => bb.log.warn(`Backup cleanup failed: ${error instanceof Error ? error.message : String(error)}`));

  bb.rpc.register(backupContract, {
    "backup.create": async () => {
      const name = backupFileName();
      const summary = await service.backup(join(downloads, name));
      const older = (await readdir(downloads)).filter((each) => /^bb-studio-backup-.*\.zip$/.test(each)).sort().reverse().slice(KEEP_DOWNLOADS);
      for (const each of older) await rm(join(downloads, each), { force: true });
      return {
        name,
        bytes: summary.bytes,
        sections: summary.manifest.sections.map((section) => ({ pluginId: section.pluginId, name: section.name, status: section.status, reason: section.reason, counts: section.counts })),
        excluded: summary.manifest.excluded,
        text: formatBackup({ ...summary, file: name }),
      };
    },
    "backup.upload": async ({ uploadId, offset, data }) => {
      const bytes = Buffer.from(data, "base64");
      if (!bytes.length) throw new Error("This chunk is empty; the file has nothing to restore.");
      if (bytes.length > UPLOAD_CHUNK_BYTES) throw new Error("Upload chunks are at most 4 MB.");
      const id = uploadId ?? `up_${randomBytes(12).toString("hex")}`;
      if (!uploadId && offset !== 0) throw new Error("A new upload starts at offset 0.");
      await mkdir(uploads, { recursive: true });
      const path = uploadPath(id);
      const size = uploadId ? (await stat(path).catch(() => null))?.size : 0;
      if (size === undefined || size === null) throw new Error("That upload no longer exists; choose the file again.");
      // Chunks arrive in order; a repeated chunk after a lost response is accepted once.
      if (offset + bytes.length <= size) return { uploadId: id, received: size };
      if (offset !== size) throw new Error(`Upload out of order: expected offset ${size}, got ${offset}.`);
      if (size + bytes.length > MAX_UPLOAD) throw new Error("This backup is larger than 4 GB, which the Setup page can't take. Use bb studio restore <file> instead.");
      const handle = await open(path, uploadId ? "a" : "wx");
      try {
        await handle.write(bytes);
      } finally {
        await handle.close();
      }
      return { uploadId: id, received: size + bytes.length };
    },
    "backup.restore": async ({ uploadId, dryRun }) => {
      const path = uploadPath(uploadId);
      const hash = await fileHash(path).catch(() => null);
      if (!dryRun && (!hash || checked.get(uploadId) !== hash)) throw new Error("Check this file first: restore only runs on the exact file that was just checked. Choose it again.");
      const summary = await service.restore(path, { dryRun });
      if (dryRun && hash) checked.set(uploadId, hash);
      const result = restoreResult(summary);
      // Keep the file when something failed, so the restore can run again without uploading it again.
      if (!dryRun && !result.failed) {
        checked.delete(uploadId);
        await rm(path, { force: true });
      }
      return result;
    },
    "backup.discard": async ({ uploadId }) => {
      checked.delete(uploadId);
      await rm(uploadPath(uploadId), { force: true });
      return { ok: true };
    },
  });

  bb.http.route("GET", "/backup", async (context) => {
    const name = context.req.query("name") ?? "";
    if (!/^bb-studio-backup-[0-9T-]+\.zip$/.test(name)) return context.text("Not found", 404);
    const path = join(downloads, name);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) return context.text("This backup is gone; make a new one.", 404);
    return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
      headers: {
        "content-type": "application/zip",
        "content-length": String(info.size),
        "content-disposition": `attachment; filename="${name}"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  });
}
