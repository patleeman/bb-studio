// Studio's artifact RPC methods (artifacts are built into Studio). They are
// the old Artifacts plugin's methods with an `artifacts.` prefix, so Studio's
// app, the iOS app and the Artifacts upgrade bridge
// (packages/bb-studio-artifacts) share one set of shapes. The kit holds them
// because the bridge is a separate package and can't import Studio.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

/** BB's download cap; larger files are refused at save time. */
export const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;

export const versionSchema = z.object({
  id: z.string(),
  number: z.number(),
  name: z.string(),
  mime: z.string(),
  size: z.number(),
  type: z.enum(["image", "audio", "video", "html", "markdown", "code", "text", "pdf", "other"]),
  createdAt: z.number(),
});

export const artifactSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  projectId: z.string().nullable(),
  sourceThreadId: z.string().nullable(),
  sourcePath: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  archived: z.boolean(),
  version: versionSchema,
  versions: z.number(),
});

export const candidateSchema = z.object({
  path: z.string(),
  display: z.string(),
  kind: z.enum(["image", "created", "changed", "storage"]),
  /** Already saved from this thread. */
  artifactId: z.string().nullable(),
});

const idSchema = z.string().min(1).max(100);
const threadIdSchema = z.string().min(1).max(200);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

/** What the app and native clients call. */
export const rpcContract = defineRpcContract({
  "artifacts.get": {
    input: z.object({ id: idSchema }),
    output: z.object({ artifact: artifactSchema.nullable(), versions: z.array(versionSchema) }),
  },
  "artifacts.versionBytes": {
    input: z.object({ id: idSchema, versionId: idSchema }),
    output: z.object({ bytes: z.string().nullable(), sha256: z.string().nullable() }),
  },
  /** A text version's contents, for the viewer and Copy. */
  "artifacts.text": {
    input: z.object({ id: idSchema, versionId: idSchema }),
    output: z.object({ text: z.string().nullable(), truncated: z.boolean() }),
  },
  "artifacts.update": {
    input: z.object({ id: idSchema, title: z.string().trim().max(200).optional(), description: z.string().max(2000).optional() }),
    output: z.object({ ok: z.boolean() }),
  },
  "artifacts.delete": {
    input: z.object({ id: idSchema }),
    output: z.object({ ok: z.boolean() }),
  },
  "artifacts.move": {
    input: z.object({ id: idSchema, projectId: z.string().min(1).max(200).nullable() }),
    output: z.object({ ok: z.boolean() }),
  },
  /** Artifacts saved from one thread, newest first. */
  "artifacts.threadArtifacts": {
    input: z.object({ threadId: threadIdSchema }),
    output: z.object({ artifacts: z.array(artifactSchema) }),
  },
  /**
   * Files a reply produced (the reply ending at `seq`, or the latest one), and
   * the thread's storage files, for "Save to Studio".
   */
  "artifacts.candidates": {
    input: z.object({ threadId: threadIdSchema, seq: z.number().int().nonnegative().nullable() }),
    output: z.object({
      reply: z.array(candidateSchema),
      storage: z.array(candidateSchema),
      /** Why thread storage couldn't be listed, e.g. its host is offline. */
      storageError: z.string().nullable(),
    }),
  },
  "artifacts.saveFiles": {
    input: z.object({ threadId: threadIdSchema, paths: z.array(z.string().min(1).max(4096)).min(1).max(50) }),
    output: z.object({
      saved: z.array(
        z.object({ path: z.string(), artifactId: z.string(), outcome: z.enum(["created", "versioned", "unchanged"]), restored: z.boolean() }),
      ),
      failed: z.array(z.object({ path: z.string(), error: z.string() })),
    }),
  },
  /** Saves a photo or file selected on the phone into Studio. */
  "artifacts.importFile": {
    input: z.object({
      name: z.string().min(1).max(255),
      mime: z.string().min(1).max(200),
      bytes: z.string().max(4 * Math.ceil(MAX_ARTIFACT_BYTES / 3)),
      projectId: z.string().max(200).nullable(),
    }),
    output: z.object({ id: idSchema }),
  },
  /** Copies a Markdown or text artifact into a new Studio page. */
  "artifacts.saveAsPage": {
    input: z.object({ id: idSchema }),
    output: z.object({ href: z.string() }),
  },
});

const time = z.number().int().min(0);
export const importVersionSchema = z.object({
  id: idSchema,
  number: z.number().int().min(1),
  name: z.string().min(1).max(1000),
  mime: z.string().min(1).max(300),
  size: z.number().int().min(0).max(MAX_ARTIFACT_BYTES),
  sha256,
  createdAt: time,
});
export const importArtifactSchema = z.object({
  id: idSchema,
  title: z.string().max(10_000),
  description: z.string().max(100_000),
  projectId: z.string().min(1).max(200).nullable(),
  sourceThreadId: z.string().min(1).max(500).nullable(),
  sourcePath: z.string().min(1).max(10_000).nullable(),
  createdAt: time,
  updatedAt: time,
  updatedBy: z.string().max(50).nullable(),
  archivedAt: time.nullable(),
  versions: z.array(importVersionSchema).min(1).max(10_000),
});
export type ImportArtifact = z.infer<typeof importArtifactSchema>;

/** Rows per `artifacts.importRows` call; bytes go one blob per call. */
export const IMPORT_BATCH = 100;

/**
 * The upgrade bridge's methods: it copies the old plugin's rows into Studio
 * (blobs first, then rows), and forwards old mentions. Not for clients.
 */
export const bridgeContract = defineRpcContract({
  /** Which of these blobs Studio doesn't have yet. */
  "artifacts.missingBlobs": {
    input: z.object({ sha256: z.array(sha256).max(1000) }),
    output: z.object({ missing: z.array(sha256) }),
  },
  /** One blob; its hash is checked. Storing a blob twice is a no-op. */
  "artifacts.importBlob": {
    input: z.object({ sha256, bytes: z.string().max(4 * Math.ceil(MAX_ARTIFACT_BYTES / 3) + 4) }),
    output: z.object({ ok: z.boolean() }),
  },
  /**
   * Artifact rows and their versions. An artifact or version Studio already
   * has (same id) is left as it is, so a rerun changes nothing; one whose
   * blobs are missing, or whose source file Studio already saved as another
   * artifact, is skipped with the reason.
   */
  "artifacts.importRows": {
    input: z.object({ artifacts: z.array(importArtifactSchema).max(IMPORT_BATCH) }),
    output: z.object({
      imported: z.array(z.string()),
      existing: z.array(z.string()),
      skipped: z.array(z.object({ id: z.string(), reason: z.string() })),
    }),
  },
  /** What an old `@artifact` mention pill gives the agent. */
  "artifacts.mentionContext": {
    input: z.object({ id: idSchema }),
    output: z.object({ context: z.string() }),
  },
});

/** The Artifacts plugin release that is only the upgrade bridge. */
export const ARTIFACTS_BRIDGE_VERSION = "0.2.0";

/** Where the bridge's copy into Studio stands; Studio's Setup page asks before removal. */
export const migrationStatusSchema = z.object({
  /** Every well-formed artifact is in Studio. */
  complete: z.boolean(),
  /** Artifacts in the old plugin. */
  total: z.number(),
  /** Copied (or already in Studio). */
  copied: z.number(),
  /** Rows that can't be copied, and why; they stay in the old plugin. */
  skipped: z.array(z.object({ id: z.string(), reason: z.string() })),
  /** Why the last attempt failed, e.g. Studio isn't running. */
  error: z.string().nullable(),
});
export type MigrationStatus = z.infer<typeof migrationStatusSchema>;

/** The bridge's own method. */
export const bridgeStatusContract = defineRpcContract({
  migrationStatus: { input: z.null(), output: migrationStatusSchema },
});
