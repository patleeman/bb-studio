import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Ref } from "./services";

type Sdk = { plugins: { callRpc<T>(args: { pluginId: string; method: string; input: never; outputSchema: z.ZodType<T>; signal?: AbortSignal }): Promise<T> } };
const botsSchema = z.object({ bots: z.array(z.object({ id: z.string(), name: z.string(), handle: z.string().optional(), retired: z.boolean().optional() })) });
const conversationSchema = z.object({ id: z.string() });

/** Send a comment's explicit @bot mentions to each bot's direct conversation. */
export async function routeCommentMentions(sdk: Sdk, ref: Ref, body: string, href: string): Promise<void> {
  if (!body.includes("@")) return;
  const call = <T>(method: string, input: unknown, outputSchema: z.ZodType<T>) =>
    sdk.plugins.callRpc({ pluginId: "bot-teams", method, input: input as never, outputSchema, signal: AbortSignal.timeout(10_000) });
  const { bots } = await call("list", null, botsSchema);
  for (const bot of bots) {
    if (bot.retired) continue;
    const names = [bot.name, bot.handle].filter((name): name is string => Boolean(name));
    if (!names.some((name) => new RegExp(`(^|[^\\w])@${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`, "i").test(body))) continue;
    const conversation = await call("conversation", { id: bot.id }, conversationSchema);
    await call("send", {
      id: conversation.id, text: `Comment on ${href}:\n\n${body}\n\nRead the item and reply to the comment.`,
      attachmentIds: [], replyTo: null, requestId: randomUUID(),
    }, z.object({}).passthrough());
  }
}
