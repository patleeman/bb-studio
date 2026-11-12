import { z } from "zod";
import { EFFECTS } from "./appearance";
import { formatListing, formatReport, type ThemeOutcome, type ThemeService } from "./service";
import type { ThemeCreator } from "./store";
import { THEME_FORMAT_GUIDE, themeTemplateJson } from "./template";

export const THEME_TOOLS = ["theme_list", "theme_create", "theme_update", "theme_apply", "theme_delete"] as const;

export interface ThemeToolContext { threadId?: string }
export interface ThemeToolDeps {
  service: ThemeService;
  creator(threadId: string | undefined): Promise<ThemeCreator | null>;
  resolveBot(ref: string | undefined, threadId: string | undefined): Promise<{ id: string; name: string } | string>;
}

export interface ThemeTool {
  name: (typeof THEME_TOOLS)[number];
  description: string;
  parameters: z.ZodObject<z.ZodRawShape>;
  execute(input: never, ctx: ThemeToolContext): Promise<string>;
}

const unit = z.number().min(0).max(1);
const themeObject = z.record(z.string(), z.unknown());
const effectSwitches = z.object(Object.fromEntries(EFFECTS.map((key) => [key, z.boolean().optional()])) as Record<(typeof EFFECTS)[number], z.ZodOptional<z.ZodBoolean>>);

function outcomeText(outcome: ThemeOutcome, verb: string): string {
  if (outcome.ok) return `${verb} ${outcome.theme.id} (${outcome.theme.name}). theme_apply puts it on a Bot.\n${formatReport(outcome.report)}`;
  const reasons = outcome.reasons.map((reason) => `- ${reason}`).join("\n");
  return `Not saved. Nothing changed.\n${reasons}${outcome.report ? `\n${formatReport(outcome.report)}` : ""}`;
}

export function themeTools(deps: ThemeToolDeps): ThemeTool[] {
  const { service } = deps;
  const list: ThemeTool = {
    name: "theme_list",
    description: "List BB Studio's themes: built-in and stored (agent-made) ones, with id, name, kind (scene or classic), source, light/dark variants, who made it and which Bots use it.",
    parameters: z.object({ id: z.string().max(60).optional().describe("Show one theme's full package as JSON") }),
    execute: async (input: { id?: string }) => {
      if (input.id) {
        const theme = service.get(input.id);
        return theme ? JSON.stringify(theme, null, 2) : `No theme ${input.id}.`;
      }
      return service.list().map(formatListing).join("\n");
    },
  };
  const create: ThemeTool = {
    name: "theme_create",
    description: `Create a BB Studio theme from a full theme package you write from the user's description: a GLSL shader scene (or none for a classic theme), palette, glass, type and state effects. It runs every check first and saves only when all pass; a failure saves nothing and lists each failed check. Then theme_apply puts it on a Bot. The id must be new.\n\n${THEME_FORMAT_GUIDE}\n\nA working template (change the id, name, colors, shader and effects to match the description):\n${themeTemplateJson()}`,
    parameters: z.object({ theme: themeObject.describe("The full theme package") }),
    execute: async (input: { theme: Record<string, unknown> }, ctx) => outcomeText(await service.create(input.theme, await deps.creator(ctx.threadId)), "Saved"),
  };
  const update: ThemeTool = {
    name: "theme_update",
    description: "Change a stored theme: pass the fields to change (objects merge, arrays and strings replace) or a full package. It re-runs every check and saves only when all pass. Built-in themes can't be changed; pass newId to save a changed copy under a new id (this works for any theme). theme_list id:<id> shows a theme's package.",
    parameters: z.object({
      id: z.string().min(1).max(60).describe("The theme to change or copy"),
      theme: themeObject.describe("The fields to change, e.g. {\"palette\": [...], \"scene\": {\"uniforms\": {\"u_speed\": 0.5}}}"),
      newId: z.string().min(1).max(60).optional().describe("Save as a new theme with this id, leaving the original unchanged"),
    }),
    execute: async (input: { id: string; theme: Record<string, unknown>; newId?: string }, ctx) => {
      const copying = !!input.newId && input.newId !== input.id;
      const outcome = await service.update(input.id, input.theme, { ...(input.newId ? { newId: input.newId } : {}), creator: copying ? await deps.creator(ctx.threadId) : null });
      return outcomeText(outcome, copying ? "Saved a copy as" : "Updated");
    },
  };
  const apply: ThemeTool = {
    name: "theme_apply",
    description: "Put a theme on a Bot (its look in BB Studio: scene, colors, glass, type), with optional slider values and state-effect switches; themeId null takes the theme off. Without bot, the Bot this thread works for, else the user's first Bot. Sliders left out start from the theme's defaults when the theme changes, else stay.",
    parameters: z.object({
      themeId: z.string().min(1).max(60).nullable().describe("A theme id from theme_list, or null for none"),
      bot: z.string().min(1).max(200).optional().describe("A Bot's id or name"),
      intensity: unit.optional().describe("How strong the scene is, 0–1"),
      glass: unit.optional().describe("Glass opacity over the scene, 0–1: the main view's open tint and the backings behind text scale together"),
      motion: unit.optional().describe("Scene speed, 0–1"),
      effects: effectSwitches.optional().describe("State effects: workers in the scene, a ripple when a turn finishes, a pulse while waiting on the user, a red ripple on an error"),
    }),
    execute: async (input: { themeId: string | null; bot?: string; intensity?: number; glass?: number; motion?: number; effects?: Partial<Record<(typeof EFFECTS)[number], boolean>> }, ctx) => {
      const bot = await deps.resolveBot(input.bot, ctx.threadId);
      if (typeof bot === "string") return bot;
      const outcome = await service.apply({
        botId: bot.id, themeId: input.themeId,
        ...(input.intensity !== undefined ? { intensity: input.intensity } : {}),
        ...(input.glass !== undefined ? { glass: input.glass } : {}),
        ...(input.motion !== undefined ? { motion: input.motion } : {}),
        ...(input.effects ? { effects: input.effects } : {}),
      });
      if (!outcome.ok) return `Not applied.\n${outcome.reasons.map((reason) => `- ${reason}`).join("\n")}`;
      if (!outcome.appearance) return `${outcome.bot.name} has no theme now.`;
      const { appearance } = outcome;
      const on = EFFECTS.filter((key) => appearance.effects[key]);
      return `${outcome.bot.name} uses ${appearance.themeId}: intensity ${appearance.intensity}, glass ${appearance.glass}, motion ${appearance.motion}; effects on: ${on.join(", ") || "none"}.`;
    },
  };
  const remove: ThemeTool = {
    name: "theme_delete",
    description: "Delete a stored theme. Refuses built-in themes and any theme a Bot uses (theme_apply another theme to those Bots first).",
    parameters: z.object({ id: z.string().min(1).max(60) }),
    execute: async (input: { id: string }) => {
      const outcome = service.remove(input.id);
      return outcome.ok ? `Deleted ${outcome.id}.` : `Not deleted.\n${outcome.reasons.map((reason) => `- ${reason}`).join("\n")}`;
    },
  };
  return [list, create, update, apply, remove];
}
