import { z } from "zod";
import { EFFECTS } from "./appearance";
import { formatListing, formatReport, type ThemeOutcome, type ThemeService } from "./service";
import type { ThemeCreator } from "./store";

export const THEME_TOOLS = ["theme"] as const;

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
  if (outcome.ok) return `${verb} ${outcome.theme.id} (${outcome.theme.name}). theme op "apply" puts it on a Bot.\n${formatReport(outcome.report)}`;
  const reasons = outcome.reasons.map((reason) => `- ${reason}`).join("\n");
  return `Not saved. Nothing changed.\n${reasons}${outcome.report ? `\n${formatReport(outcome.report)}` : ""}`;
}

export function themeTools(deps: ThemeToolDeps): ThemeTool[] {
  const { service } = deps;
  const tool: ThemeTool = {
    name: "theme",
    description: 'Manage BB Studio themes. op: list (id? for full JSON), create (theme; load themes skill first), update (id, theme, newId? to copy), apply (themeId or null, bot?, intensity?, glass?, motion?, effects?), delete (id).',
    parameters: z.object({
      op: z.enum(["list", "create", "update", "apply", "delete"]),
      id: z.string().min(1).max(60).optional().describe("Theme id for list/update/delete"),
      newId: z.string().min(1).max(60).optional().describe("update: save changed copy under this id"),
      theme: themeObject.optional().describe("Full or partial theme package JSON (see themes skill)"),
      themeId: z.string().min(1).max(60).nullable().optional().describe("apply: theme id or null for none"),
      bot: z.string().min(1).max(200).optional().describe("apply: Bot id or name"),
      intensity: unit.optional().describe("apply: scene strength 0–1"),
      glass: unit.optional().describe("apply: glass opacity 0–1"),
      motion: unit.optional().describe("apply: scene speed 0–1"),
      effects: effectSwitches.optional().describe("apply: state effect toggles"),
    }),
    execute: async (input: {
      op: "list" | "create" | "update" | "apply" | "delete";
      id?: string; newId?: string; theme?: Record<string, unknown>;
      themeId?: string | null; bot?: string; intensity?: number; glass?: number; motion?: number;
      effects?: Partial<Record<(typeof EFFECTS)[number], boolean>>;
    }, ctx) => {
      if (input.op === "list") {
        if (input.id) {
          const found = service.get(input.id);
          return found ? JSON.stringify(found, null, 2) : `No theme ${input.id}.`;
        }
        return service.list().map(formatListing).join("\n");
      }
      if (input.op === "create") {
        if (!input.theme) return "Not saved. Pass theme (full theme package JSON).";
        return outcomeText(await service.create(input.theme, await deps.creator(ctx.threadId)), "Saved");
      }
      if (input.op === "update") {
        if (!input.id || !input.theme) return "Not saved. Pass id and theme.";
        const copying = !!input.newId && input.newId !== input.id;
        const outcome = await service.update(input.id, input.theme, { ...(input.newId ? { newId: input.newId } : {}), creator: copying ? await deps.creator(ctx.threadId) : null });
        return outcomeText(outcome, copying ? "Saved a copy as" : "Updated");
      }
      if (input.op === "apply") {
        if (input.themeId === undefined) return "Not applied. Pass themeId (a theme id or null).";
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
      }
      if (!input.id) return "Not deleted. Pass id.";
      const outcome = service.remove(input.id);
      return outcome.ok ? `Deleted ${outcome.id}.` : `Not deleted.\n${outcome.reasons.map((reason) => `- ${reason}`).join("\n")}`;
    },
  };
  return [tool];
}
