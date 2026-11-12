import { appearanceSchema, EFFECTS, withTheme, type Appearance, type EffectSwitch } from "./appearance";
import { checkTheme, type CheckLine, type CheckReport } from "./checks";
import { isBuiltinTheme, type ThemeSource } from "./registry";
import { THEME_ID, themeModes, type Mode, type ThemePackage } from "./schema";
import type { ThemeCreator, ThemeStore } from "./store";

export interface ThemeBot { id: string; name: string; appearance: Appearance | null }
export interface ThemeUser { id: string; name: string }

export interface ThemeListing {
  id: string;
  name: string;
  kind: ThemePackage["kind"];
  source: ThemeSource;
  modes: Mode[];
  palette: ThemePackage["palette"];
  creator: ThemeCreator | null;
  usedBy: ThemeUser[];
}

export interface ThemeServiceDeps {
  store: ThemeStore;
  bots(): ThemeBot[];
  setAppearance(botId: string, appearance: Appearance | null): Promise<unknown>;
  measure?(theme: ThemePackage): Promise<CheckLine[] | null>;
}

export type ThemeOutcome =
  | { ok: true; theme: ThemePackage; report: CheckReport }
  | { ok: false; reasons: string[]; report: CheckReport | null };

export interface ApplyInput {
  botId: string;
  themeId: string | null;
  intensity?: number;
  glass?: number;
  motion?: number;
  effects?: Partial<Record<EffectSwitch, boolean>>;
}
export type ApplyOutcome = { ok: true; bot: ThemeUser; appearance: Appearance | null } | { ok: false; reasons: string[] };
export type DeleteOutcome = { ok: true; id: string } | { ok: false; reasons: string[] };

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function mergeTheme(base: unknown, patch: unknown): unknown {
  if (!isObject(base) || !isObject(patch)) return patch === undefined ? base : patch;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    out[key] = isObject(value) && isObject(base[key]) ? mergeTheme(base[key], value) : value;
  }
  return out;
}

function idOf(input: unknown): string | null {
  return isObject(input) && typeof input.id === "string" ? input.id : null;
}

function failedReasons(report: CheckReport): string[] {
  return report.results.filter((line) => !line.pass).map((line) => `${line.id}: ${line.reason}`);
}

export class ThemeService {
  constructor(private readonly deps: ThemeServiceDeps) {}

  private usedBy(id: string): ThemeUser[] {
    return this.deps.bots().filter((bot) => bot.appearance?.themeId === id).map((bot) => ({ id: bot.id, name: bot.name }));
  }

  private creatorName(creator: ThemeCreator | null): ThemeCreator | null {
    if (!creator?.botId) return creator;
    const bot = this.deps.bots().find((each) => each.id === creator.botId);
    return bot ? { name: bot.name, botId: bot.id } : creator;
  }

  entries(): { source: ThemeSource; theme: ThemePackage; creator: ThemeCreator | null; usedBy: ThemeUser[] }[] {
    const creators = new Map(this.deps.store.records().map((record) => [record.theme.id, this.creatorName(record.creator)]));
    return this.deps.store.list().map((entry) => ({ ...entry, creator: creators.get(entry.theme.id) ?? null, usedBy: this.usedBy(entry.theme.id) }));
  }

  list(): ThemeListing[] {
    return this.entries().map(({ source, theme, creator, usedBy }) => ({
      id: theme.id, name: theme.name, kind: theme.kind, source, modes: themeModes(theme), palette: theme.palette, creator, usedBy,
    }));
  }

  get(id: string): ThemePackage | null {
    return this.deps.store.get(id);
  }

  listing(id: string): ThemeListing | null {
    return this.list().find((entry) => entry.id === id) ?? null;
  }

  async check(input: unknown): Promise<CheckReport> {
    const first = checkTheme(input);
    const theme = first.theme;
    if (!theme || theme.scene.kind !== "shader" || first.results.some((line) => line.id === "shader") || !this.deps.measure) return first;
    const measured = await this.deps.measure(theme).catch(() => null);
    return measured?.length ? checkTheme(input, { measured }) : first;
  }

  private async save(input: unknown, creator: ThemeCreator | null): Promise<ThemeOutcome> {
    const report = await this.check(input);
    if (!report.pass || !report.theme) return { ok: false, reasons: failedReasons(report), report };
    const measured = report.results.filter((line) => line.id === "frame-time" || line.id === "backdrop");
    const saved = this.deps.store.save(input, { measured }, creator);
    if (!saved.ok) return { ok: false, reasons: failedReasons(saved.report), report: saved.report };
    return { ok: true, theme: saved.theme, report };
  }

  async create(input: unknown, creator: ThemeCreator | null): Promise<ThemeOutcome> {
    const id = idOf(input);
    if (id && isBuiltinTheme(id)) return { ok: false, reasons: [`${id} is a built-in theme. Pick another id.`], report: null };
    if (id && this.deps.store.has(id)) return { ok: false, reasons: [`A theme ${id} exists. theme_update changes it; pick another id for a new one.`], report: null };
    return this.save(input, creator);
  }

  async update(id: string, patch: unknown, options: { newId?: string; creator: ThemeCreator | null }): Promise<ThemeOutcome> {
    const base = this.deps.store.get(id);
    if (!base) return { ok: false, reasons: [`No theme ${id}.`], report: null };
    const builtin = isBuiltinTheme(id);
    if (builtin && !options.newId) return { ok: false, reasons: [`${id} is a built-in theme and can't be changed. Pass newId to save a changed copy under a new id.`], report: null };
    const target = options.newId ?? id;
    if (!THEME_ID.test(target)) return { ok: false, reasons: [`${target}: a theme id is lowercase letters, digits and dashes.`], report: null };
    if (options.newId && options.newId !== id && (isBuiltinTheme(options.newId) || this.deps.store.has(options.newId))) return { ok: false, reasons: [`A theme ${options.newId} exists. Pick another newId.`], report: null };
    const patchId = idOf(patch);
    if (patchId && patchId !== target) return { ok: false, reasons: [`The update's id ${patchId} isn't ${target}. Use newId to copy under a new id.`], report: null };
    const merged = mergeTheme(JSON.parse(JSON.stringify(base)) as Json, patch);
    const next = isObject(merged) ? { ...merged, id: target } : merged;
    return this.save(next, options.newId && options.newId !== id ? options.creator : null);
  }

  async apply(input: ApplyInput): Promise<ApplyOutcome> {
    const bot = this.deps.bots().find((each) => each.id === input.botId);
    if (!bot) return { ok: false, reasons: [`No Bot ${input.botId}.`] };
    if (input.themeId === null) {
      await this.deps.setAppearance(bot.id, null);
      return { ok: true, bot: { id: bot.id, name: bot.name }, appearance: null };
    }
    const theme = this.deps.store.get(input.themeId);
    if (!theme) return { ok: false, reasons: [`No theme ${input.themeId}. theme_list lists them.`] };
    const current = bot.appearance;
    const base = current && current.themeId === theme.id ? current : withTheme(current, theme);
    const effects = { ...base.effects };
    for (const key of EFFECTS) if (input.effects?.[key] !== undefined) effects[key] = input.effects[key]!;
    const parsed = appearanceSchema.safeParse({
      ...base,
      ...(input.intensity !== undefined ? { intensity: input.intensity } : {}),
      ...(input.glass !== undefined ? { glass: input.glass } : {}),
      ...(input.motion !== undefined ? { motion: input.motion } : {}),
      effects,
    });
    if (!parsed.success) return { ok: false, reasons: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) };
    await this.deps.setAppearance(bot.id, parsed.data);
    return { ok: true, bot: { id: bot.id, name: bot.name }, appearance: parsed.data };
  }

  remove(id: string): DeleteOutcome {
    if (isBuiltinTheme(id)) return { ok: false, reasons: [`${id} is a built-in theme and can't be deleted.`] };
    if (!this.deps.store.has(id)) return { ok: false, reasons: [`No stored theme ${id}.`] };
    const users = this.usedBy(id);
    if (users.length) return { ok: false, reasons: [`${id} is in use by ${users.map((user) => user.name).join(", ")}. Apply another theme to ${users.length === 1 ? "that Bot" : "those Bots"} first (theme_apply).`] };
    this.deps.store.remove(id);
    return { ok: true, id };
  }
}

export function formatReport(report: CheckReport): string {
  const lines = report.results.map((line) => `${line.pass ? "pass" : "FAIL"}  ${line.id}  ${line.reason}`);
  return [`Checks ${report.pass ? "passed" : "failed"}${report.theme ? ` for ${report.theme.id}` : ""}:`, ...lines].join("\n");
}

export function formatListing(entry: ThemeListing): string {
  const by = entry.creator ? ` · made by ${entry.creator.name}` : "";
  const used = entry.usedBy.length ? ` · used by ${entry.usedBy.map((user) => user.name).join(", ")}` : "";
  return `${entry.id}\t${entry.name} (${entry.kind}, ${entry.source}, ${entry.modes.join("/")})${by}${used}`;
}
