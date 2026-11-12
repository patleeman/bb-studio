import { fullReport, staticChecks, type CheckLine, type CheckReport } from "./checks";
import { BUILTIN_FORMS, FORM_NAMES } from "./forms";
import { isBuiltinPresence, PRESENCE_ID, presenceSchema, type Presence, type PresenceColor, type PresencePackage } from "./schema";
import type { PresenceCreator, PresenceStore } from "./store";

export interface PresenceBot { id: string; name: string; presence: Presence }
export interface PresenceUser { id: string; name: string }
export type PresenceSource = "builtin" | "stored";

export interface PresenceListing {
  id: string;
  name: string;
  description: string;
  source: PresenceSource;
  creator: PresenceCreator | null;
  usedBy: PresenceUser[];
}
export interface PresenceEntry extends PresenceListing { code: string | null; updatedAt: number }

export interface PresenceServiceDeps {
  store: PresenceStore;
  bots(): PresenceBot[];
  setPresence(botId: string, presence: Presence): Promise<unknown>;
  measure?(presence: PresencePackage): Promise<CheckLine[] | null>;
}

export type PresenceOutcome =
  | { ok: true; presence: PresencePackage; report: CheckReport }
  | { ok: false; reasons: string[]; report: CheckReport | null };
export interface ApplyInput { botId: string; form?: string; color?: PresenceColor; motion?: number }
export type ApplyOutcome = { ok: true; bot: PresenceUser; presence: Presence } | { ok: false; reasons: string[] };
export type DeleteOutcome = { ok: true; id: string } | { ok: false; reasons: string[] };

const BUILTIN_DESCRIPTIONS: Record<(typeof BUILTIN_FORMS)[number], string> = {
  orb: "Three drifting lobes in a glass sphere.",
  tesseract: "A hypercube turning in four dimensions.",
  knot: "A trefoil torus knot.",
  swarm: "A cloud of orbiting particles.",
  mobius: "A one-sided ribbon with a light running round it.",
  poly: "Icosahedron, dodecahedron, cube and octahedron, each fading into the next.",
  attractor: "The Lorenz attractor's butterfly trail.",
  klein: "A Klein bottle in wireframe.",
};

function failedReasons(report: CheckReport): string[] {
  return report.results.filter((line) => !line.pass).map((line) => `${line.id}: ${line.reason}`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withDefaults(input: unknown): unknown {
  return isObject(input) && input.description === undefined ? { ...input, description: "" } : input;
}

export class PresenceService {
  constructor(private readonly deps: PresenceServiceDeps) {}

  private usedBy(id: string): PresenceUser[] {
    return this.deps.bots().filter((bot) => bot.presence.form === id).map((bot) => ({ id: bot.id, name: bot.name }));
  }

  private creatorName(creator: PresenceCreator | null): PresenceCreator | null {
    if (!creator?.botId) return creator;
    const bot = this.deps.bots().find((each) => each.id === creator.botId);
    return bot ? { name: bot.name, botId: bot.id } : creator;
  }

  entries(): PresenceEntry[] {
    const builtin = BUILTIN_FORMS.map((id): PresenceEntry => ({ id, name: FORM_NAMES[id], description: BUILTIN_DESCRIPTIONS[id], source: "builtin", creator: null, usedBy: this.usedBy(id), code: null, updatedAt: 0 }));
    const stored = this.deps.store.records().map((record): PresenceEntry => ({
      id: record.presence.id, name: record.presence.name, description: record.presence.description, source: "stored",
      creator: this.creatorName(record.creator), usedBy: this.usedBy(record.presence.id), code: record.presence.code, updatedAt: record.updatedAt,
    }));
    return [...builtin, ...stored];
  }

  list(): PresenceListing[] {
    return this.entries().map(({ code: _code, updatedAt: _updatedAt, ...listing }) => listing);
  }

  get(id: string): PresencePackage | null {
    return this.deps.store.get(id)?.presence ?? null;
  }

  exists(id: string): boolean {
    return isBuiltinPresence(id) || this.deps.store.has(id);
  }

  async check(input: unknown): Promise<CheckReport> {
    const first = staticChecks(withDefaults(input));
    if (!first.pass || !first.presence) return first;
    const measured = this.deps.measure ? await this.deps.measure(first.presence).catch(() => null) : null;
    return fullReport(first, measured);
  }

  private async save(input: unknown, creator: PresenceCreator | null): Promise<PresenceOutcome> {
    const report = await this.check(input);
    if (!report.pass || !report.presence) return { ok: false, reasons: failedReasons(report), report };
    this.deps.store.save(report.presence, creator);
    return { ok: true, presence: report.presence, report };
  }

  async create(input: unknown, creator: PresenceCreator | null): Promise<PresenceOutcome> {
    const id = isObject(input) && typeof input.id === "string" ? input.id : null;
    if (id && isBuiltinPresence(id)) return { ok: false, reasons: [`${id} is a built-in form. Pick another id.`], report: null };
    if (id && this.deps.store.has(id)) return { ok: false, reasons: [`A presence ${id} exists. presence_update changes it; pick another id for a new one.`], report: null };
    return this.save(input, creator);
  }

  async update(id: string, patch: unknown, options: { newId?: string; creator: PresenceCreator | null }): Promise<PresenceOutcome> {
    if (isBuiltinPresence(id)) return { ok: false, reasons: [`${id} is a built-in form and can't be changed.`], report: null };
    const base = this.get(id);
    if (!base) return { ok: false, reasons: [`No presence ${id}.`], report: null };
    const target = options.newId ?? id;
    if (!PRESENCE_ID.test(target)) return { ok: false, reasons: [`${target}: a presence id is lowercase letters, digits and dashes.`], report: null };
    if (target !== id && this.exists(target)) return { ok: false, reasons: [`A presence ${target} exists. Pick another newId.`], report: null };
    if (!isObject(patch)) return { ok: false, reasons: ["The update is an object with the fields to change: name, description, code."], report: null };
    if (typeof patch.id === "string" && patch.id !== target) return { ok: false, reasons: [`The update's id ${patch.id} isn't ${target}. Use newId to copy under a new id.`], report: null };
    return this.save({ ...base, ...patch, id: target }, target !== id ? options.creator : null);
  }

  async apply(input: ApplyInput): Promise<ApplyOutcome> {
    const bot = this.deps.bots().find((each) => each.id === input.botId);
    if (!bot) return { ok: false, reasons: [`No Bot ${input.botId}.`] };
    if (input.form !== undefined && !this.exists(input.form)) return { ok: false, reasons: [`No presence ${input.form}. presence_list lists them.`] };
    const parsed = presenceSchema.safeParse({
      form: input.form ?? bot.presence.form,
      color: input.color ?? bot.presence.color,
      motion: input.motion ?? bot.presence.motion,
    });
    if (!parsed.success) return { ok: false, reasons: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) };
    await this.deps.setPresence(bot.id, parsed.data);
    return { ok: true, bot: { id: bot.id, name: bot.name }, presence: parsed.data };
  }

  remove(id: string): DeleteOutcome {
    if (isBuiltinPresence(id)) return { ok: false, reasons: [`${id} is a built-in form and can't be deleted.`] };
    if (!this.deps.store.has(id)) return { ok: false, reasons: [`No stored presence ${id}.`] };
    const users = this.usedBy(id);
    if (users.length) return { ok: false, reasons: [`${id} is in use by ${users.map((user) => user.name).join(", ")}. Apply another presence to ${users.length === 1 ? "that Bot" : "those Bots"} first (presence_apply).`] };
    this.deps.store.remove(id);
    return { ok: true, id };
  }
}

export function formatListing(entry: PresenceListing): string {
  const by = entry.creator ? ` · made by ${entry.creator.name}` : "";
  const used = entry.usedBy.length ? ` · used by ${entry.usedBy.map((user) => user.name).join(", ")}` : "";
  return `${entry.id}\t${entry.name} (${entry.source})${entry.description ? ` · ${entry.description}` : ""}${by}${used}`;
}

export function formatPresence(presence: Presence): string {
  return `${presence.form}, color ${presence.color.source === "custom" ? presence.color.hex : "from theme"}, motion ${presence.motion}`;
}
