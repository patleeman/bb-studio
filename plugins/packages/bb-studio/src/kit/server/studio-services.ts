import { z } from "zod";
import { STUDIO_PLUGIN_ID } from "../contract";
import type { Actor } from "./actor";

import { itemServicesContract as contract } from "../item-services-contract";
import type { Ref as StudioRef, ItemLink as StudioLink, ItemActivity as StudioActivity, ItemThread } from "../item-services-contract";
export type { Ref as StudioRef, ItemLink as StudioLink, ItemActivity as StudioActivity } from "../item-services-contract";

type Sdk = { plugins: { callRpc<T>(args: { pluginId: string; method: string; input: never; outputSchema: z.ZodType<T>; signal?: AbortSignal }): Promise<T> } };

/** RPC client for external add-ons. Built-in kinds receive services directly. */
export function studioServices(sdk: Sdk) {
  const call = <K extends keyof typeof contract>(method: K, input: z.input<(typeof contract)[K]["input"]>): Promise<z.output<(typeof contract)[K]["output"]>> =>
    sdk.plugins.callRpc({ pluginId: STUDIO_PLUGIN_ID, method, input: input as never, outputSchema: contract[method].output as unknown as z.ZodType<z.output<(typeof contract)[K]["output"]>>, signal: AbortSignal.timeout(10_000) });
  return {
    links: (item: StudioRef) => call("links", { ref: item }),
    replaceLinks: (item: StudioRef, source: string, links: StudioLink[]) => call("replaceLinks", { ref: item, source, links }),
    threads: (item: StudioRef) => call("itemThreads", { ref: item }),
    linkThread: (entry: ItemThread) => call("linkItemThread", { thread: entry }),
    /** Links an item an agent made to its thread; Studio lists it with the thread. */
    created: (item: StudioRef, threadId: string) => {
      const at = Date.now();
      return call("linkItemThread", { thread: { threadId, ref: item, role: "created", state: "working", createdAt: at, updatedAt: at, metadata: {} } });
    },
    spawnForItem: (input: { ref: StudioRef; prompt: string; role: string; projectId?: string | null; metadata?: Record<string, string>; visibility?: "user" | "agent-only" }) =>
      call("spawnForItem", input),
    activity: (input: { ref?: StudioRef; since?: number; limit?: number } = {}) => call("activity", input),
    recordActivity: (input: StudioActivity) => call("recordActivity", input),
    comments: (item: StudioRef) => call("comments", { ref: item }),
    commentCreate: (input: { ref: StudioRef; parentId: string | null; anchor: string | null; actor: Actor; body: string }) => call("commentCreate", input),
    commentResolve: (item: StudioRef, id: string, resolved: boolean) => call("commentResolve", { ref: item, id, resolved }),
    versions: (item: StudioRef) => call("versions", { ref: item }),
    versionCreate: (input: { ref: StudioRef; bytes: string; label: string; actor: Actor }) => call("versionCreate", input),
    versionRead: (item: StudioRef, id: string) => call("versionRead", { ref: item, id }),
  };
}
