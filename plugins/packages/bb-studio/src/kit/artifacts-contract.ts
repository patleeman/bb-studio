// Studio's artifact RPC methods (artifacts are built into Studio). They are
// the old Artifacts plugin's methods with an `artifacts.` prefix, shared by
// Studio's app and the iOS app's generated contract.
import type { defineRpcContract as sdkDefineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

// Studio's frontend imports this file, and a plugin's frontend bundle can't
// resolve the root SDK. The SDK's helper only returns its argument.
const defineRpcContract: typeof sdkDefineRpcContract = (contract) => contract;

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
