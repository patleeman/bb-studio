// Studio's design RPC methods (designs are built into Studio). They are the
// old Studio Design plugin's (`design`) client methods with a `designs.`
// prefix, so Studio's app, the iOS app and the Design upgrade bridge
// (packages/bb-studio-design) share one set of shapes. The kit holds them
// because the bridge is a separate package and can't import Studio.
import type { defineRpcContract as sdkDefineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

// Studio's frontend imports this file, and a plugin's frontend bundle can't
// resolve the root SDK. The SDK's helper only returns its argument.
const defineRpcContract: typeof sdkDefineRpcContract = (contract) => contract;

/** A screen id: a round number and an option letter, like "1a". */
export const DESIGN_SCREEN_ID = /^([1-9][0-9]{0,2})([a-z])$/;

export const designViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  projectId: z.string().nullable(),
  threadId: z.string().nullable(),
  updatedAt: z.number(),
  rounds: z.array(z.object({
    round: z.number(),
    title: z.string(),
    intro: z.string(),
    screens: z.array(z.object({
      id: z.string(),
      round: z.number(),
      option: z.string(),
      title: z.string(),
      caption: z.string(),
      /** A preset name ("desktop", "slide") or "WIDTHxHEIGHT". */
      viewport: z.string(),
      updatedAt: z.number(),
      steps: z.array(z.object({ id: z.string(), label: z.string() })),
      url: z.string(),
    })),
  })),
  comments: z.array(z.object({
    id: z.string(),
    screenId: z.string(),
    step: z.string(),
    selector: z.string(),
    elementText: z.string(),
    body: z.string(),
    createdAt: z.number(),
    sent: z.boolean(),
  })),
  review: z.object({
    state: z.enum(["reviewing", "done", "needs_work", "failed"]),
    round: z.number().nullable(),
    screens: z.array(z.string()),
    at: z.number(),
    summary: z.string().nullable(),
  }).nullable(),
});

/** Longest text one on-canvas edit replaces. */
export const MAX_EDIT_TEXT = 5000;

/** What the app and native clients call. */
export const rpcContract = defineRpcContract({
  "designs.getDesign": {
    input: z.object({ id: z.string() }),
    output: z.object({ design: designViewSchema.nullable() }),
  },
  "designs.renameDesign": {
    input: z.object({ id: z.string(), name: z.string().max(200) }),
    output: z.object({ ok: z.boolean(), updatedAt: z.number() }),
  },
  "designs.deleteDesign": {
    input: z.object({ id: z.string() }),
    output: z.object({ ok: z.boolean() }),
  },
  /** Pins a comment to an element of a screen; `send` also posts it to the design's conversation. */
  "designs.addComment": {
    input: z.object({
      designId: z.string(),
      screenId: z.string().regex(DESIGN_SCREEN_ID),
      step: z.string().regex(/^[A-Za-z0-9_-]{0,40}$/).default(""),
      selector: z.string().min(1).max(2000),
      elementHtml: z.string().max(5000),
      elementText: z.string().max(400),
      body: z.string().trim().min(1).max(4000),
      send: z.boolean(),
    }),
    output: z.object({ id: z.string(), sent: z.boolean() }),
  },
  /** An element's text the user edited right on the canvas, as inner HTML before and after. */
  "designs.editText": {
    input: z.object({ designId: z.string(), screenId: z.string().regex(DESIGN_SCREEN_ID), before: z.string().min(1).max(MAX_EDIT_TEXT), after: z.string().max(MAX_EDIT_TEXT) }),
    output: z.object({ ok: z.boolean(), reason: z.enum(["missing", "ambiguous", "markup"]).optional() }),
  },
  "designs.sendComment": {
    input: z.object({ id: z.string() }),
    output: z.object({ ok: z.boolean() }),
  },
  "designs.resolveComment": {
    input: z.object({ id: z.string(), resolved: z.boolean() }),
    output: z.object({ ok: z.boolean() }),
  },
  "designs.deleteComment": {
    input: z.object({ id: z.string() }),
    output: z.object({ ok: z.boolean() }),
  },
});

const time = z.number().int().min(0);
/** Studio Design's backup allows screens this big; agents write at most 400,000 characters. */
export const MAX_IMPORT_SCREEN_CHARS = 1_000_000;

export const importDesignSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().max(10_000),
  createdAt: time,
  updatedAt: time,
  projectId: z.string().min(1).max(200).nullable(),
  updatedBy: z.string().max(50).nullable(),
  archivedAt: time.nullable(),
  template: z.boolean(),
  /** The design's conversation. */
  threadId: z.string().min(1).max(200).nullable(),
  rounds: z.array(z.object({ round: z.number().int().min(1).max(999), title: z.string().max(10_000), intro: z.string().max(100_000) })).max(1000),
  screens: z.array(z.object({
    id: z.string().regex(DESIGN_SCREEN_ID),
    round: z.number().int().min(1).max(999),
    title: z.string().max(10_000),
    caption: z.string().max(100_000),
    viewport: z.string().max(40),
    html: z.string().max(MAX_IMPORT_SCREEN_CHARS),
    createdAt: time,
    updatedAt: time,
  })).max(26_000),
  comments: z.array(z.object({
    id: z.string().min(1).max(200),
    screenId: z.string().max(10),
    step: z.string().max(100),
    selector: z.string().max(10_000),
    elementHtml: z.string().max(100_000),
    elementText: z.string().max(10_000),
    body: z.string().max(100_000),
    createdAt: time,
    sentAt: time.nullable(),
    resolvedAt: time.nullable(),
  })).max(10_000),
});
export type ImportDesign = z.infer<typeof importDesignSchema>;

export const importStyleSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().max(10_000),
  notes: z.string().max(1_000_000),
  css: z.string().max(1_000_000),
  sourceDesignId: z.string().max(200).nullable(),
  sourceScreenId: z.string().max(10).nullable(),
  createdAt: time,
  updatedAt: time,
});
export type ImportStyle = z.infer<typeof importStyleSchema>;

/** Designs per `designs.importRows` call, and the screen characters a call carries (one larger design goes alone). */
export const IMPORT_BATCH = 100;
export const IMPORT_BATCH_CHARS = 8 * 1024 * 1024;

const importResult = z.object({
  imported: z.array(z.string()),
  existing: z.array(z.string()),
  skipped: z.array(z.object({ id: z.string(), reason: z.string() })),
});

/**
 * The upgrade bridge's methods: it copies the old plugin's rows into Studio,
 * and forwards old mentions. Not for clients.
 */
export const bridgeContract = defineRpcContract({
  /**
   * Designs with their rounds, screens and comments. A design Studio already
   * has (same id) is left as it is, so a rerun changes nothing.
   */
  "designs.importRows": {
    input: z.object({ designs: z.array(importDesignSchema).max(IMPORT_BATCH) }),
    output: importResult,
  },
  /** Saved styles. One Studio has (same id) is left alone; one whose name Studio already uses is skipped. */
  "designs.importStyles": {
    input: z.object({ styles: z.array(importStyleSchema).max(IMPORT_BATCH) }),
    output: importResult,
  },
  /** What an old `@design` mention pill gives the agent. */
  "designs.mentionContext": {
    input: z.object({ id: z.string().min(1).max(200) }),
    output: z.object({ context: z.string() }),
  },
});

/** The Studio Design plugin release that is only the upgrade bridge. */
export const DESIGN_BRIDGE_VERSION = "0.2.0";

export { bridgeStatusContract, migrationStatusSchema, type MigrationStatus } from "./draw-contract";
