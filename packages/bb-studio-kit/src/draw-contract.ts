// Studio's drawing RPC methods (drawings are built into Studio). They are the
// old Draw plugin's (`excalidraw`) methods with a `drawings.` prefix, shared by
// Studio's app and the iOS app's generated contract.
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
