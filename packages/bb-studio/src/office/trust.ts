import type { BbPluginApi, JsonValue, PluginAgentToolContext } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { ModuleServices } from "../modules/services";

export const OFFICE_TRUST_RENDERER = "office-trust";
const profileSchema = z.object({ botId: z.string().nullable() }).nullable();
const botSchema = z.object({ bot: z.object({ id: z.string(), name: z.string(), trust: z.enum(["ask", "act"]).default("ask"), retired: z.boolean().optional() }) });

export function permissionForTrust(trust: "ask" | "act"): "accept-edits" | "auto" {
  return trust === "act" ? "auto" : "accept-edits";
}

/** The callback must be the exact mutation whose arguments are shown. A grant
 * applies to this invocation only; cancellations and malformed submissions deny. */
export async function withOfficeTrust<T>(bb: Pick<BbPluginApi, "ui">, modules: ModuleServices, context: PluginAgentToolContext,
  toolName: string, args: JsonValue, mutate: () => Promise<T> | T): Promise<T> {
  context.signal.throwIfAborted();
  const profile = modules.has("bot-teams") ? profileSchema.parse(await modules.call("bot-teams", "threadProfile", { threadId: context.threadId })) : null;
  if (profile?.botId) {
    const { bot } = botSchema.parse(await modules.call("bot-teams", "get", { id: profile.botId }));
    if (bot.retired) throw new Error("This bot is retired.");
    if (bot.trust === "ask") {
      const result = await bb.ui.requestInput({
        threadId: context.threadId, rendererId: OFFICE_TRUST_RENDERER,
        title: `${bot.name} wants to use ${toolName}`,
        payload: { toolName, arguments: args, botId: bot.id, botName: bot.name },
        presentation: {
          icon: { glyph: "ShieldCheck" }, label: { pending: "Waiting for approval", completed: "Approval answered" },
        },
        describeSubmission: value => ({ title: z.object({ approved: z.literal(true) }).safeParse(value).success ? `Approved ${toolName}` : `Denied ${toolName}` }),
      }, { signal: context.signal });
      if (result.outcome !== "submitted" || !z.object({ approved: z.literal(true) }).safeParse(result.value).success) throw new Error("The Studio change was not approved.");
      const current = profileSchema.parse(await modules.call("bot-teams", "threadProfile", { threadId: context.threadId }));
      if (current?.botId !== bot.id) throw new Error("The thread's bot changed while approval was pending. Try again.");
    }
  }
  context.signal.throwIfAborted();
  return mutate();
}
