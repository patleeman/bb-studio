// The applets plugin API. The settings page uses it, the shell relays
// `window.studio.bb.*` calls to it, and `bb plugin rpc call applets <method>`
// reaches it from scripts. It ships with the plugin, so it can grow without a
// new signed shell; the applet-facing `window.studio` API is versioned
// separately (APPLET_API).
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const shellStatusSchema = z.object({
  state: z.enum(["not-installed", "stopped", "running"]),
  appPath: z.string().nullable(),
  version: z.string().nullable(),
  socketPath: z.string(),
});

export const appletSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  version: z.string().nullable(),
  description: z.string().nullable(),
  capabilities: z.array(z.string()),
  granted: z.array(z.string()),
  pending: z.array(z.string()),
  errors: z.array(z.string()),
});
export type AppletRow = z.infer<typeof appletSchema>;

export const threadSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  projectId: z.string().nullable(),
  status: z.string(),
  needsYou: z.boolean(),
  updatedAt: z.number().nullable(),
});
export type ThreadSummary = z.infer<typeof threadSummarySchema>;

export const timelineItemSchema = z.object({
  id: z.string(),
  type: z.enum(["user", "assistant", "tool"]),
  text: z.string(),
  status: z.string().nullable(),
  createdAt: z.number().nullable(),
});
export type TimelineItem = z.infer<typeof timelineItemSchema>;

const appletId = z.object({ id: z.string() });

export const rpcContract = defineRpcContract({
  status: {
    input: z.null(),
    output: z.object({ root: z.string(), shell: shellStatusSchema, applets: z.array(appletSchema) }),
  },
  "applets.list": { input: z.null(), output: z.array(appletSchema) },
  "applets.grant": { input: appletId.extend({ capabilities: z.array(z.string()) }), output: appletSchema },
  "applets.revoke": { input: appletId, output: z.null() },
  "applets.remove": { input: appletId, output: z.null() },
  "applets.logs": { input: appletId, output: z.object({ text: z.string() }) },
  "threads.list": {
    input: z.object({ projectId: z.string().optional(), active: z.boolean().optional() }).nullable(),
    output: z.array(threadSummarySchema),
  },
  "threads.get": { input: z.object({ threadId: z.string() }), output: threadSummarySchema },
  /** The thread and its recent messages and tool calls, oldest first. */
  "threads.timeline": {
    input: z.object({ threadId: z.string(), limit: z.number().int().min(1).max(200).optional() }),
    output: z.object({ thread: threadSummarySchema, items: z.array(timelineItemSchema), waitingOnYou: z.boolean() }),
  },
  "threads.tell": {
    input: z.object({
      threadId: z.string(),
      text: z.string().min(1).max(20_000),
      /** While the thread works: "queue" waits for its turn to end (default), "steer" joins the running turn. */
      mode: z.enum(["queue", "steer"]).optional(),
    }),
    output: z.null(),
  },
  "threads.stop": { input: z.object({ threadId: z.string() }), output: z.null() },
  "threads.open": { input: z.object({ threadId: z.string() }), output: z.null() },
});
