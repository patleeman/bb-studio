import { z } from "zod";
import type { Actor } from "@bb-studio/kit/server";
import type { ItemComment, Ref } from "./services";

type Sdk = { plugins: { callRpc<T>(args: { pluginId: string; method: string; input: never; outputSchema: z.ZodType<T>; signal?: AbortSignal }): Promise<T> } };
const threadsSchema = z.object({ threads: z.array(z.object({
  id: z.string(), resolved: z.boolean(), blockId: z.string().nullable(), updatedAt: z.number(),
  comments: z.array(z.object({ id: z.string(), author: z.string(), text: z.string(), createdAt: z.number() })),
})) });
const resultSchema = z.object({ threadId: z.string() });
const okSchema = z.object({ ok: z.boolean() });

function actor(author: string): Actor {
  if (author.startsWith("bot:")) return { kind: "bot", id: author.slice(4) };
  if (author.startsWith("agent:")) return { kind: "agent", id: author.slice(6) };
  return { kind: "user" };
}

/** Pages keeps comments in Yjs; this adapter presents them through the shared API. */
export class ProviderComments {
  constructor(private readonly sdk: Sdk) {}
  private call<T>(method: string, input: unknown, outputSchema: z.ZodType<T>): Promise<T> {
    return this.sdk.plugins.callRpc({ pluginId: "pages", method, input: input as never, outputSchema, signal: AbortSignal.timeout(10_000) });
  }
  async list(ref: Ref): Promise<ItemComment[] | null> {
    if (ref.pluginId !== "pages") return null;
    const { threads } = await this.call("comments", { id: ref.id, includeResolved: true }, threadsSchema);
    return threads.flatMap((thread) => thread.comments.map((entry, index) => ({
      id: index ? entry.id : thread.id, ref, parentId: index ? thread.id : null, anchor: thread.blockId,
      actor: actor(entry.author), body: entry.text, createdAt: entry.createdAt,
      resolvedAt: thread.resolved ? thread.updatedAt : null,
    })));
  }
  async create(input: { ref: Ref; parentId: string | null; anchor: string | null; actor: Actor; body: string }): Promise<ItemComment | null> {
    if (input.ref.pluginId !== "pages") return null;
    if (input.parentId) {
      await this.call("commentReply", { id: input.ref.id, thread: input.parentId, text: input.body }, okSchema);
    } else {
      if (!input.anchor) throw new Error("Select a page block for this comment.");
      await this.call("commentCreate", { id: input.ref.id, block: input.anchor, text: input.body }, resultSchema);
    }
    const comments = await this.list(input.ref);
    const created = comments?.filter((comment) => comment.body === input.body).at(-1);
    if (!created) throw new Error("Page comment was saved but could not be read.");
    return created;
  }
  async resolve(ref: Ref, id: string, resolved: boolean): Promise<boolean | null> {
    if (ref.pluginId !== "pages") return null;
    const result = await this.call("commentResolve", { id: ref.id, thread: id, resolved }, okSchema);
    return result.ok;
  }
}
