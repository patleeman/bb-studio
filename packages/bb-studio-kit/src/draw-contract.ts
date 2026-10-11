// Studio's drawing RPC methods (drawings are built into Studio). They are the
// old Draw plugin's (`excalidraw`) methods with a `drawings.` prefix, so
// Studio's app, the iOS app and the Draw upgrade bridge
// (packages/bb-studio-draw) share one set of shapes. The kit holds them
// because the bridge is a separate package and can't import Studio.
import type { defineRpcContract as sdkDefineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

// Studio's frontend imports this file, and a plugin's frontend bundle can't
// resolve the root SDK. The SDK's helper only returns its argument.
const defineRpcContract: typeof sdkDefineRpcContract = (contract) => contract;

export const drawingMetaSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  elementCount: z.number(),
  projectId: z.string().nullable(),
  archived: z.boolean(),
});

export const drawingFullSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  projectId: z.string().nullable(),
  /** Serialized Excalidraw scene JSON (elements/appState/files). */
  data: z.string(),
});

const nameSchema = z.string().trim().max(200);

/** What the app and native clients call. */
export const rpcContract = defineRpcContract({
  "drawings.listDrawings": {
    input: z.null(),
    output: z.object({ drawings: z.array(drawingMetaSchema) }),
  },
  "drawings.createDrawing": {
    input: z.object({
      name: nameSchema,
      projectId: z.string().min(1).max(200).nullable().optional(),
    }),
    output: z.object({ drawing: drawingMetaSchema }),
  },
  "drawings.getDrawing": {
    input: z.object({ id: z.string() }),
    output: z.object({ drawing: drawingFullSchema.nullable() }),
  },
  /** A drawing's card in a reply: its name and size, without the scene. */
  "drawings.getDrawingMeta": {
    input: z.object({ id: z.string() }),
    output: z.object({ drawing: drawingMetaSchema.nullable() }),
  },
  "drawings.getDrawingUpdatedAt": {
    input: z.object({ id: z.string() }),
    output: z.object({ updatedAt: z.number() }),
  },
  "drawings.saveDrawing": {
    input: z.object({
      id: z.string(),
      name: nameSchema.optional(),
      data: z.string(),
      /** Recovery only: refuse a draft based on an older server revision. */
      expectedUpdatedAt: z.number().optional(),
    }),
    output: z.object({ ok: z.boolean(), updatedAt: z.number() }),
  },
  "drawings.recoverDrawingCopy": {
    input: z.object({
      sourceDrawingId: z.string().min(1).max(200),
      draftId: z.string().min(1).max(200),
      draftToken: z.string().min(1).max(200),
      name: nameSchema,
      data: z.string(),
      projectId: z.string().min(1).max(200).nullable().optional(),
    }),
    output: z.object({ drawing: drawingMetaSchema }),
  },
  "drawings.renameDrawing": {
    input: z.object({ id: z.string(), name: nameSchema }),
    output: z.object({ ok: z.boolean(), updatedAt: z.number() }),
  },
  "drawings.deleteDrawing": {
    input: z.object({ id: z.string() }),
    output: z.object({ ok: z.boolean() }),
  },
  "drawings.attachDrawingImage": {
    input: z.object({
      threadId: z.string(),
      drawingId: z.string(),
      /** Base64-encoded PNG, rendered client-side by the editor. */
      pngBase64: z.string(),
    }),
    output: z.object({ ok: z.boolean() }),
  },
  /**
   * Blocks until the user picks a drawing in the host-rendered picker
   * (pendingInteraction slot "excalidraw-picker"). Returns null on cancel.
   */
  "drawings.pickDrawing": {
    input: z.object({ threadId: z.string() }),
    output: z.object({ drawingId: z.string().nullable() }),
  },
});

const time = z.number().int().min(0);
/** A scene can hold images as data URLs; Draw's backup allows items this big. */
export const MAX_SCENE_CHARS = 256 * 1024 * 1024;

export const importDrawingSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().max(10_000),
  data: z.string().max(MAX_SCENE_CHARS),
  createdAt: time,
  updatedAt: time,
  projectId: z.string().min(1).max(200).nullable(),
  updatedBy: z.string().max(50).nullable(),
  archivedAt: time.nullable(),
  template: z.boolean(),
  /** The editor's recovery-copy keys that made this drawing, so a retried draft doesn't copy it twice. */
  recoveryKeys: z.array(z.string().min(1).max(1000)).max(1000),
});
export type ImportDrawing = z.infer<typeof importDrawingSchema>;

/** Rows per `drawings.importRows` call, and the scene characters a call carries (one larger row goes alone). */
export const IMPORT_BATCH = 100;
export const IMPORT_BATCH_CHARS = 8 * 1024 * 1024;

/**
 * The upgrade bridge's methods: it copies the old plugin's rows into Studio,
 * and forwards old mentions and thumbnails. Not for clients.
 */
export const bridgeContract = defineRpcContract({
  /**
   * Drawing rows. A drawing Studio already has (same id) is left as it is,
   * so a rerun changes nothing; one whose scene isn't a drawing is skipped
   * with the reason.
   */
  "drawings.importRows": {
    input: z.object({ drawings: z.array(importDrawingSchema).max(IMPORT_BATCH) }),
    output: z.object({
      imported: z.array(z.string()),
      existing: z.array(z.string()),
      skipped: z.array(z.object({ id: z.string(), reason: z.string() })),
    }),
  },
  /** What an old `@drawing` mention pill gives the agent. */
  "drawings.mentionContext": {
    input: z.object({ id: z.string().min(1).max(200) }),
    output: z.object({ context: z.string() }),
  },
  /** A drawing's thumbnail SVG, for the old thumbnail URL. */
  "drawings.thumbnail": {
    input: z.object({ id: z.string().min(1).max(200) }),
    output: z.object({ svg: z.string().nullable() }),
  },
});

/** The Draw plugin release that is only the upgrade bridge. */
export const DRAW_BRIDGE_VERSION = "0.2.0";

/** Where the bridge's copy into Studio stands; Studio's Setup page asks before removal. */
export const migrationStatusSchema = z.object({
  /** Every well-formed drawing is in Studio. */
  complete: z.boolean(),
  /** Drawings in the old plugin. */
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
