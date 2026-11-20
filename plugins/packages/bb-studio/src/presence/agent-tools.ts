import { z } from "zod";
import { formatReport } from "./checks";
import { MAX_MOTION } from "./schema";
import { formatListing, formatPresence, type PresenceOutcome, type PresenceService } from "./service";
import type { PresenceCreator } from "./store";
import { opNeeds, type OpError } from "../op-errors";

export const PRESENCE_TOOLS = ["presence"] as const;

export interface PresenceToolContext { threadId?: string }
export interface PresenceToolDeps {
  service: PresenceService;
  creator(threadId: string | undefined): Promise<PresenceCreator | null>;
  resolveBot(ref: string | undefined, threadId: string | undefined): Promise<{ id: string; name: string } | string>;
}

export interface PresenceTool {
  name: (typeof PRESENCE_TOOLS)[number];
  description: string;
  parameters: z.ZodObject<z.ZodRawShape>;
  execute(input: never, ctx: PresenceToolContext): Promise<string | OpError>;
}

const colorInput = z.string().regex(/^(theme|#[0-9a-fA-F]{6})$/, "theme or #rrggbb");

export function colorFrom(input: string): { source: "theme" } | { source: "custom"; hex: string } {
  return input === "theme" ? { source: "theme" } : { source: "custom", hex: input.toLowerCase() };
}

function outcomeText(outcome: PresenceOutcome, verb: string): string {
  if (outcome.ok) return `${verb} ${outcome.presence.id} (${outcome.presence.name}). presence op "apply" puts it on a Bot.\n${formatReport(outcome.report)}`;
  const reasons = outcome.reasons.map((reason) => `- ${reason}`).join("\n");
  return `Not saved. Nothing changed.\n${reasons}${outcome.report ? `\n${formatReport(outcome.report)}` : ""}`;
}

export function presenceTools(deps: PresenceToolDeps): PresenceTool[] {
  const { service } = deps;
  const tool: PresenceTool = {
    name: "presence",
    description: 'Manage Bot presences (living icons). op: list (id? for full JSON+code), create (id, name, code, description?; load presences skill first), update (id, name?/description?/code?, newId? to copy), apply (form?, bot?, color? "theme"|"#rrggbb", motion? 0–2), delete (id).',
    parameters: z.object({
      op: z.enum(["list", "create", "update", "apply", "delete"]),
      id: z.string().min(2).max(60).optional().describe("Presence id for list/create/update/delete"),
      newId: z.string().min(2).max(40).optional().describe("update: save changed copy under this id"),
      name: z.string().min(1).max(40).optional(),
      description: z.string().max(200).optional(),
      code: z.string().min(1).optional().describe("Plain JS declaring function draw(ctx, t, state, palette, size)"),
      form: z.string().min(2).max(40).optional().describe("apply: built-in or stored presence id"),
      bot: z.string().min(1).max(200).optional().describe("apply: Bot id or name"),
      color: colorInput.optional().describe("apply: theme or #rrggbb"),
      motion: z.number().min(0).max(MAX_MOTION).optional().describe(`apply: speed 0–${MAX_MOTION}; 1 is normal`),
    }),
    execute: async (input: {
      op: "list" | "create" | "update" | "apply" | "delete";
      id?: string; newId?: string; name?: string; description?: string; code?: string;
      form?: string; bot?: string; color?: string; motion?: number;
    }, ctx) => {
      if (input.op === "list") {
        if (!input.id) return service.list().map(formatListing).join("\n");
        const found = service.get(input.id);
        if (found) return JSON.stringify(found, null, 2);
        const builtin = service.list().find((entry) => entry.id === input.id);
        return builtin ? formatListing(builtin) : `No presence ${input.id}.`;
      }
      if (input.op === "create") {
        if (!input.id || !input.name || !input.code) return opNeeds("create", ["id", "name", "code"]);
        return outcomeText(await service.create({ id: input.id, name: input.name, description: input.description ?? "", code: input.code }, await deps.creator(ctx.threadId)), "Saved");
      }
      if (input.op === "update") {
        if (!input.id) return opNeeds("update", ["id"]);
        const copying = !!input.newId && input.newId !== input.id;
        const patch = { ...(input.name !== undefined ? { name: input.name } : {}), ...(input.description !== undefined ? { description: input.description } : {}), ...(input.code !== undefined ? { code: input.code } : {}) };
        const outcome = await service.update(input.id, patch, { ...(input.newId ? { newId: input.newId } : {}), creator: copying ? await deps.creator(ctx.threadId) : null });
        return outcomeText(outcome, copying ? "Saved a copy as" : "Updated");
      }
      if (input.op === "apply") {
        const bot = await deps.resolveBot(input.bot, ctx.threadId);
        if (typeof bot === "string") return bot;
        const outcome = await service.apply({ botId: bot.id, ...(input.form !== undefined ? { form: input.form } : {}), ...(input.color !== undefined ? { color: colorFrom(input.color) } : {}), ...(input.motion !== undefined ? { motion: input.motion } : {}) });
        if (!outcome.ok) return `Not applied.\n${outcome.reasons.map((reason) => `- ${reason}`).join("\n")}`;
        return `${outcome.bot.name} shows ${formatPresence(outcome.presence)}.`;
      }
      if (!input.id) return opNeeds("delete", ["id"]);
      const outcome = service.remove(input.id);
      return outcome.ok ? `Deleted ${outcome.id}.` : `Not deleted.\n${outcome.reasons.map((reason) => `- ${reason}`).join("\n")}`;
    },
  };
  return [tool];
}
