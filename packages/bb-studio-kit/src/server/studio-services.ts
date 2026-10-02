import { z } from "zod";
import { STUDIO_PLUGIN_ID } from "../contract";
import type { Actor } from "./actor";

export interface StudioRef { pluginId: string; id: string }
export interface StudioLink { from: StudioRef; to: StudioRef; kind: "mention" | "embed" | "task-link" | "related"; source: string }
export interface StudioActivity { actor: Actor; verb: string; ref: StudioRef; at: number; summary: string }
const ref = z.object({ pluginId: z.string(), id: z.string() });
const actor = z.object({ kind: z.enum(["user", "agent", "bot", "cli", "app", "editor"]), id: z.string().optional(), name: z.string().optional() });
const link = z.object({ from: ref, to: ref, kind: z.enum(["mention", "embed", "task-link", "related"]), source: z.string() });
const thread = z.object({ threadId: z.string(), ref, role: z.string(), state: z.string(), createdAt: z.number(), updatedAt: z.number(), metadata: z.record(z.string(), z.string()) });
const activity = z.object({ id: z.number(), actor, verb: z.string(), ref, at: z.number(), summary: z.string() });
const comment = z.object({ id: z.string(), ref, parentId: z.string().nullable(), anchor: z.string().nullable(), actor, body: z.string(), createdAt: z.number(), resolvedAt: z.number().nullable() });
const version = z.object({ id: z.string(), ref, sha256: z.string(), label: z.string(), actor, createdAt: z.number() });

type Sdk = { plugins: { callRpc<T>(args: { pluginId: string; method: string; input: never; outputSchema: z.ZodType<T>; signal?: AbortSignal }): Promise<T> } };

/** Calls the optional Studio hub. Add-ons can work without it. */
export function studioServices(sdk: Sdk) {
  const call = <T>(method: string, input: unknown, outputSchema: z.ZodType<T>) =>
    sdk.plugins.callRpc({ pluginId: STUDIO_PLUGIN_ID, method, input: input as never, outputSchema, signal: AbortSignal.timeout(10_000) });
  return {
    links: (item: StudioRef) => call("links", { ref: item }, z.object({ outgoing: z.array(link), backlinks: z.array(link) })),
    replaceLinks: (item: StudioRef, source: string, links: StudioLink[]) => call("replaceLinks", { ref: item, source, links }, z.object({ ok: z.boolean() })),
    threads: (item: StudioRef) => call("itemThreads", { ref: item }, z.object({ threads: z.array(thread) })),
    linkThread: (entry: z.infer<typeof thread>) => call("linkItemThread", { thread: entry }, z.object({ ok: z.boolean() })),
    /** Links an item an agent made to its thread; Studio files it in the thread's spaces. */
    created: (item: StudioRef, threadId: string) => {
      const at = Date.now();
      return call("linkItemThread", { thread: { threadId, ref: item, role: "created", state: "working", createdAt: at, updatedAt: at, metadata: {} } }, z.object({ ok: z.boolean() }));
    },
    spawnForItem: (input: { ref: StudioRef; prompt: string; role: string; projectId?: string | null; metadata?: Record<string, string>; visibility?: "user" | "agent-only" }) =>
      call("spawnForItem", input, z.object({ threadId: z.string() })),
    activity: (input: { ref?: StudioRef; since?: number; limit?: number } = {}) => call("activity", input, z.object({ events: z.array(activity) })),
    recordActivity: (input: StudioActivity) => call("recordActivity", input, z.object({ id: z.number() })),
    comments: (item: StudioRef) => call("comments", { ref: item }, z.object({ comments: z.array(comment) })),
    commentCreate: (input: { ref: StudioRef; parentId: string | null; anchor: string | null; actor: Actor; body: string }) => call("commentCreate", input, z.object({ comment })),
    commentResolve: (item: StudioRef, id: string, resolved: boolean) => call("commentResolve", { ref: item, id, resolved }, z.object({ ok: z.boolean() })),
    versions: (item: StudioRef) => call("versions", { ref: item }, z.object({ versions: z.array(version) })),
    versionCreate: (input: { ref: StudioRef; bytes: string; label: string; actor: Actor }) => call("versionCreate", input, z.object({ version })),
    versionRead: (item: StudioRef, id: string) => call("versionRead", { ref: item, id }, z.object({ bytes: z.string().nullable() })),
  };
}
