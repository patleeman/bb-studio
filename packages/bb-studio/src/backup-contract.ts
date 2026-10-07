// The RPCs behind the Backup and Restore section of Studio's Setup page; the
// CLI is `bb studio backup` / `bb studio restore`. See src/backup/service.ts
// and docs/backup.md. A finished backup downloads over HTTP
// (`/api/v1/plugins/studio/http/backup?name=…`); a backup to restore uploads
// in chunks, so no single call carries the whole file.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { studioBackupSchemas } from "@bb-studio/kit/backup";
import { z } from "zod";
import { UPLOAD_CHUNK_BYTES } from "./backup-upload";

export { UPLOAD_CHUNK_BYTES };
const uploadId = z.string().regex(/^up_[a-f0-9]{24}$/);
const fileName = z.string().regex(/^bb-studio-backup-[0-9T-]+\.zip$/);

export const backupSectionSchema = z.object({
  pluginId: z.string(),
  name: z.string(),
  status: z.enum(["included", "skipped", "failed"]),
  reason: z.string().nullable(),
  counts: z.record(z.string(), z.number()),
});

export const restoreSectionSchema = z.object({
  pluginId: z.string(),
  name: z.string(),
  status: z.enum(["restored", "skipped", "failed"]),
  reason: z.string().nullable(),
  report: studioBackupSchemas(z).report.nullable(),
});
export type RestoreSectionView = z.infer<typeof restoreSectionSchema>;

export const restoreResultSchema = z.object({
  dryRun: z.boolean(),
  createdAt: z.string(),
  sections: z.array(restoreSectionSchema),
  projects: z.object({ mapped: z.number(), unmapped: z.array(z.object({ name: z.string(), path: z.string().nullable() })) }),
  /** The same summary `bb studio restore` prints. */
  text: z.string(),
  failed: z.boolean(),
});
export type RestoreResult = z.infer<typeof restoreResultSchema>;

export const backupContract = defineRpcContract({
  "backup.create": {
    experimental_description: "Back up every Studio item into one file on the BB server, ready to download.",
    input: z.null(),
    output: z.object({ name: fileName, bytes: z.number(), sections: z.array(backupSectionSchema), excluded: z.array(z.object({ what: z.string(), why: z.string() })), text: z.string() }),
  },
  "backup.upload": {
    experimental_description: "Upload a backup file to restore, one chunk at a time. Start with uploadId null and offset 0.",
    input: z.object({ uploadId: uploadId.nullable(), offset: z.number().int().min(0), data: z.string().max(Math.ceil(UPLOAD_CHUNK_BYTES / 3) * 4) }).strict(),
    output: z.object({ uploadId, received: z.number() }),
  },
  "backup.restore": {
    experimental_description: "Restore an uploaded backup. With dryRun, report what would change and change nothing.",
    input: z.object({ uploadId, dryRun: z.boolean() }).strict(),
    output: restoreResultSchema,
  },
  "backup.discard": {
    experimental_description: "Delete an uploaded backup file.",
    input: z.object({ uploadId }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
});
