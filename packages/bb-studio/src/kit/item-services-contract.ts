import { z } from "zod";
import { studioTagSchemas } from "./contract";

const pluginId = z.string().min(1).max(100);
const projectId = z.string().min(1).max(200).nullable();
const { itemRef } = studioTagSchemas(z);
const actor = z.object({ kind: z.enum(["user", "agent", "bot", "cli", "app", "editor"]), id: z.string().optional(), name: z.string().optional() });
const link = z.object({ from: itemRef, to: itemRef, kind: z.enum(["mention", "embed", "task-link", "related"]), source: pluginId });
const activityEvent = z.object({ actor, verb: z.string().min(1).max(100), ref: itemRef, at: z.number(), summary: z.string().max(2000) });
const thread = z.object({ threadId: z.string(), ref: itemRef, role: z.string(), state: z.string(), createdAt: z.number(), updatedAt: z.number(), metadata: z.record(z.string(), z.string()) });
const comment = z.object({ id: z.string(), ref: itemRef, parentId: z.string().nullable(), anchor: z.string().nullable(), actor, body: z.string(), createdAt: z.number(), resolvedAt: z.number().nullable() });
const version = z.object({ id: z.string(), ref: itemRef, sha256: z.string(), label: z.string(), actor, createdAt: z.number() });

export const itemServicesContract = {
  links: { input: z.object({ ref: itemRef }), output: z.object({ outgoing: z.array(link), backlinks: z.array(link) }) },
  replaceLinks: { input: z.object({ ref: itemRef, source: pluginId, links: z.array(link).max(500) }), output: z.object({ ok: z.boolean() }) },
  itemThreads: { input: z.object({ ref: itemRef }), output: z.object({ threads: z.array(thread) }) },
  linkItemThread: { input: z.object({ thread }), output: z.object({ ok: z.boolean() }) },
  /** The items linked to a thread: made in it, mentioned when it started, or handed off to it. */
  threadItems: { input: z.object({ threadId: z.string().min(1).max(200) }), output: z.object({ threads: z.array(thread) }) },
  spawnForItem: { input: z.object({ ref: itemRef, prompt: z.string().min(1).max(100000), role: z.string().min(1).max(100), metadata: z.record(z.string(), z.string()).optional(), projectId: projectId.optional(), visibility: z.enum(["user", "agent-only"]).optional() }), output: z.object({ threadId: z.string() }) },
  activity: { input: z.object({ ref: itemRef.optional(), since: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(100).optional() }), output: z.object({ events: z.array(activityEvent.extend({ id: z.number() })) }) },
  recordActivity: { input: activityEvent, output: z.object({ id: z.number() }) },
  comments: { input: z.object({ ref: itemRef }), output: z.object({ comments: z.array(comment) }) },
  commentCreate: { input: z.object({ ref: itemRef, parentId: z.string().nullable(), anchor: z.string().nullable(), actor, body: z.string().min(1).max(10000) }), output: z.object({ comment }) },
  commentResolve: { input: z.object({ ref: itemRef, id: z.string(), resolved: z.boolean() }), output: z.object({ ok: z.boolean() }) },
  versions: { input: z.object({ ref: itemRef }), output: z.object({ versions: z.array(version) }) },
  versionCreate: { input: z.object({ ref: itemRef, bytes: z.string().max(16_000_000), label: z.string().max(200), actor }), output: z.object({ version }) },
  versionRead: { input: z.object({ ref: itemRef, id: z.string() }), output: z.object({ bytes: z.string().nullable() }) },
};

export type Ref = z.infer<typeof itemRef>;
export type ItemLink = z.infer<typeof link>;
export type ItemActivity = z.infer<typeof activityEvent>;
export type ItemThread = z.infer<typeof thread>;
export type ItemComment = z.infer<typeof comment>;
export type ItemVersion = z.infer<typeof version>;
