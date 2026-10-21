// Studio's design RPC methods (designs are built into Studio). They are the
// old Studio Design plugin's (`design`) client methods with a `designs.`
// prefix, shared by Studio's app and the iOS app's generated contract.
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
