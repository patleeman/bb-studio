import { z } from "zod";
import { formatReport } from "./checks";
import { MAX_MOTION } from "./schema";
import { formatListing, formatPresence, type PresenceOutcome, type PresenceService } from "./service";
import type { PresenceCreator } from "./store";
import { PRESENCE_FORMAT_GUIDE, presenceTemplateJson } from "./template";

export const PRESENCE_TOOLS = ["presence_list", "presence_create", "presence_update", "presence_apply", "presence_delete"] as const;

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
  execute(input: never, ctx: PresenceToolContext): Promise<string>;
}

const colorInput = z.string().regex(/^(theme|#[0-9a-fA-F]{6})$/, "theme or #rrggbb");

export function colorFrom(input: string): { source: "theme" } | { source: "custom"; hex: string } {
  return input === "theme" ? { source: "theme" } : { source: "custom", hex: input.toLowerCase() };
}

function outcomeText(outcome: PresenceOutcome, verb: string): string {
  if (outcome.ok) return `${verb} ${outcome.presence.id} (${outcome.presence.name}). presence_apply puts it on a Bot.\n${formatReport(outcome.report)}`;
  const reasons = outcome.reasons.map((reason) => `- ${reason}`).join("\n");
  return `Not saved. Nothing changed.\n${reasons}${outcome.report ? `\n${formatReport(outcome.report)}` : ""}`;
}

export function presenceTools(deps: PresenceToolDeps): PresenceTool[] {
  const { service } = deps;
  const list: PresenceTool = {
    name: "presence_list",
    description: "List BB Studio's presences (a Bot's living icon): the eight built-in forms and stored (agent-made) ones, with id, name, source, who made it and which Bots use it.",
    parameters: z.object({ id: z.string().max(60).optional().describe("Show one stored presence's full package, with its code, as JSON") }),
    execute: async (input: { id?: string }) => {
      if (!input.id) return service.list().map(formatListing).join("\n");
      const presence = service.get(input.id);
      if (presence) return JSON.stringify(presence, null, 2);
      const builtin = service.list().find((entry) => entry.id === input.id);
      return builtin ? formatListing(builtin) : `No presence ${input.id}.`;
    },
  };
  const create: PresenceTool = {
    name: "presence_create",
    description: `Create a presence from the user's description (e.g. "a slowly unfolding origami crane", "a lava lamp"): you write a small canvas module. It runs every check first, in a sandbox in an open BB Studio window, and saves only when all pass; a failure saves nothing and lists each failed check. Then presence_apply puts it on a Bot. The id must be new.\n\n${PRESENCE_FORMAT_GUIDE}\n\nA working template (change the id, name, description and drawing to match the description):\n${presenceTemplateJson()}`,
    parameters: z.object({
      id: z.string().min(2).max(40).describe("Lowercase letters, digits and dashes"),
      name: z.string().min(1).max(40),
      description: z.string().max(200).optional().describe("One line: what it shows"),
      code: z.string().min(1).describe("The module: plain JavaScript declaring function draw(ctx, t, state, palette, size)"),
    }),
    execute: async (input: { id: string; name: string; description?: string; code: string }, ctx) =>
      outcomeText(await service.create({ id: input.id, name: input.name, description: input.description ?? "", code: input.code }, await deps.creator(ctx.threadId)), "Saved"),
  };
  const update: PresenceTool = {
    name: "presence_update",
    description: "Change a stored presence: pass the fields to change (name, description, code). It re-runs every check and saves only when all pass. Built-in forms can't be changed. Pass newId to save a changed copy under a new id. presence_list id:<id> shows a presence's code.",
    parameters: z.object({
      id: z.string().min(2).max(40).describe("The presence to change or copy"),
      name: z.string().min(1).max(40).optional(),
      description: z.string().max(200).optional(),
      code: z.string().min(1).optional(),
      newId: z.string().min(2).max(40).optional().describe("Save as a new presence with this id, leaving the original unchanged"),
    }),
    execute: async (input: { id: string; name?: string; description?: string; code?: string; newId?: string }, ctx) => {
      const copying = !!input.newId && input.newId !== input.id;
      const patch = { ...(input.name !== undefined ? { name: input.name } : {}), ...(input.description !== undefined ? { description: input.description } : {}), ...(input.code !== undefined ? { code: input.code } : {}) };
      const outcome = await service.update(input.id, patch, { ...(input.newId ? { newId: input.newId } : {}), creator: copying ? await deps.creator(ctx.threadId) : null });
      return outcomeText(outcome, copying ? "Saved a copy as" : "Updated");
    },
  };
  const apply: PresenceTool = {
    name: "presence_apply",
    description: "Put a presence on a Bot: a built-in form (orb, tesseract, knot, swarm, mobius, poly, attractor, klein) or a stored presence's id, with an optional color source and motion. Without bot, the Bot this thread works for, else the user's first Bot. Fields left out stay as they are.",
    parameters: z.object({
      form: z.string().min(2).max(40).optional().describe("A presence id from presence_list"),
      bot: z.string().min(1).max(200).optional().describe("A Bot's id or name"),
      color: colorInput.optional().describe("theme to take the theme's colors, or a #rrggbb color"),
      motion: z.number().min(0).max(MAX_MOTION).optional().describe(`Speed, 0–${MAX_MOTION}; 1 is normal`),
    }),
    execute: async (input: { form?: string; bot?: string; color?: string; motion?: number }, ctx) => {
      const bot = await deps.resolveBot(input.bot, ctx.threadId);
      if (typeof bot === "string") return bot;
      const outcome = await service.apply({ botId: bot.id, ...(input.form !== undefined ? { form: input.form } : {}), ...(input.color !== undefined ? { color: colorFrom(input.color) } : {}), ...(input.motion !== undefined ? { motion: input.motion } : {}) });
      if (!outcome.ok) return `Not applied.\n${outcome.reasons.map((reason) => `- ${reason}`).join("\n")}`;
      return `${outcome.bot.name} shows ${formatPresence(outcome.presence)}.`;
    },
  };
  const remove: PresenceTool = {
    name: "presence_delete",
    description: "Delete a stored presence. Refuses built-in forms and any presence a Bot uses (presence_apply another form to those Bots first).",
    parameters: z.object({ id: z.string().min(2).max(40) }),
    execute: async (input: { id: string }) => {
      const outcome = service.remove(input.id);
      return outcome.ok ? `Deleted ${outcome.id}.` : `Not deleted.\n${outcome.reasons.map((reason) => `- ${reason}`).join("\n")}`;
    },
  };
  return [list, create, update, apply, remove];
}
