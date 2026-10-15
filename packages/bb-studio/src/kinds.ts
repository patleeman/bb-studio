// Studio's built-in kinds: whether each is on, and which provider opens and
// creates it ("Open and create with"). Setup's Kinds section edits this; see
// docs/studio.md, "Replacing a built-in kind".
//
// - Off: the built-in's provider doesn't answer (its items, search hits and
//   New entries leave Studio), its agent tools and instructions aren't given
//   to new sessions, and the frontend drops its thread tab, composer entries
//   and reply cards after a window reload. Its data stays; turning it on
//   restores everything.
// - Open and create with: an external provider kind may declare
//   `replaces: "<built-in kind id>"` in studio_describe. The user's explicit
//   choice wins, then a single replacing provider, then the built-in. The
//   chosen provider gets the New entries and agent creation hints; the other
//   candidates keep their items (built-in items keep opening in the built-in)
//   but offer no New entry.
import type { ProviderView } from "./contract";

export interface BuiltinKind {
  /** The kind id items carry, e.g. "page". */
  kind: string;
  /** The built-in's provider id (its old add-on id). */
  pluginId: string;
  /** "Pages" */
  label: string;
  /** What turning it off hides, for Setup. */
  covers: string;
}

export const BUILTIN_KINDS: readonly BuiltinKind[] = [
  { kind: "page", pluginId: "pages", label: "Pages", covers: "Pages, pages in the thread's Studio tab, page cards and the thread header's page link." },
  { kind: "drawing", pluginId: "excalidraw", label: "Drawings", covers: "Drawings, drawings in the thread's Studio tab, drawing cards and the composer's + → Drawing." },
  { kind: "recording", pluginId: "talk", label: "Recordings and dictation", covers: "Recordings, the recorder, dictation, hold-to-talk, recording cards and Talk models." },
  { kind: "artifact", pluginId: "artifacts", label: "Artifacts", covers: "Artifacts, artifacts and the save picker in the thread's Studio tab, and artifact cards." },
  { kind: "design", pluginId: "design", label: "Designs", covers: "Designs, designs in the thread's Studio tab, and design cards." },
  { kind: "dashboard", pluginId: "dashboards", label: "Dashboards", covers: "Dashboards, their agent tools and the refreshing of their widgets' data." },
];

const BY_KIND = new Map(BUILTIN_KINDS.map((each) => [each.kind, each]));
const BY_PLUGIN = new Map(BUILTIN_KINDS.map((each) => [each.pluginId, each]));

/** The value of "Open and create with" that means Studio's own kind. */
export const BUILTIN_CHOICE = "studio";

export interface KindSettings {
  /** Built-in kind ids turned off. */
  off: string[];
  /** Built-in kind id → BUILTIN_CHOICE or a provider plugin id, when the user chose. */
  use: Record<string, string>;
}

export const KINDS_KV_KEY = "kinds:settings";
export const DEFAULT_KIND_SETTINGS: KindSettings = { off: [], use: {} };

/** Stored settings, dropping anything that isn't a built-in kind. */
export function parseKindSettings(raw: unknown): KindSettings {
  const value = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof KindSettings, unknown>>;
  const off = Array.isArray(value.off) ? [...new Set(value.off.filter((kind): kind is string => typeof kind === "string" && BY_KIND.has(kind)))] : [];
  const use: Record<string, string> = {};
  if (value.use && typeof value.use === "object") {
    for (const [kind, choice] of Object.entries(value.use as Record<string, unknown>)) {
      if (BY_KIND.has(kind) && typeof choice === "string" && choice.length > 0 && choice.length <= 100) use[kind] = choice;
    }
  }
  return { off, use };
}

/** Whether a built-in provider (by plugin id) answers. Non-built-in ids always do. */
export function builtinOn(settings: KindSettings, pluginId: string): boolean {
  const builtin = BY_PLUGIN.get(pluginId);
  return !builtin || !settings.off.includes(builtin.kind);
}

export interface KindKv {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

/** The settings, persisted in Studio's KV and read synchronously once loaded. */
export class KindSettingsStore {
  private value: KindSettings = DEFAULT_KIND_SETTINGS;
  private readonly listeners = new Set<(next: KindSettings, previous: KindSettings) => void>();

  constructor(private readonly kv: KindKv) {}

  async load(): Promise<KindSettings> {
    this.value = parseKindSettings(await this.kv.get(KINDS_KV_KEY));
    return this.value;
  }

  get current(): KindSettings {
    return this.value;
  }

  onChange(listener: (next: KindSettings, previous: KindSettings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Turn a built-in kind on or off, or choose its provider (null: automatic). */
  async update(kind: string, change: { on?: boolean; use?: string | null }): Promise<KindSettings> {
    if (!BY_KIND.has(kind)) throw new Error(`${kind} isn't a kind built into Studio.`);
    const previous = this.value;
    const off = new Set(previous.off);
    if (change.on === true) off.delete(kind);
    if (change.on === false) off.add(kind);
    const use = { ...previous.use };
    if (change.use === null) delete use[kind];
    else if (typeof change.use === "string") use[kind] = change.use;
    const next = parseKindSettings({ off: [...off], use });
    await this.kv.set(KINDS_KV_KEY, next);
    this.value = next;
    for (const listener of this.listeners) listener(next, previous);
    return next;
  }
}

export interface KindCandidate {
  pluginId: string;
  /** The provider's name, e.g. "Notion". */
  name: string;
  /** The provider's kind id, e.g. "notion-page". */
  kindId: string;
  /** The provider kind's label, e.g. "Notion page". */
  label: string;
}

export type KindReason = "chosen" | "only-replacement" | "built-in";

export interface KindRoute {
  kind: string;
  /** Who opens and creates new ones; the built-in's own id when it's Studio. */
  active: KindCandidate;
  reason: KindReason;
  /** Ready providers whose kinds replace this one. */
  alternatives: KindCandidate[];
  /** The stored choice, or null for automatic. A choice that isn't available falls back. */
  choice: string | null;
}

/** Ready external providers' kinds that declare they replace a built-in kind. */
export function replacements(providers: readonly ProviderView[], kind: string): KindCandidate[] {
  return providers
    .filter((provider) => provider.state === "ready" && !BY_PLUGIN.has(provider.pluginId))
    .flatMap((provider) => provider.kinds
      .filter((each) => each.replaces === kind)
      .map((each) => ({ pluginId: provider.pluginId, name: provider.name, kindId: each.id, label: each.label })));
}

/** Who opens and creates a built-in kind: the user's choice, else a single replacement, else the built-in. */
export function resolveKind(kind: string, providers: readonly ProviderView[], settings: KindSettings): KindRoute {
  const builtin = BY_KIND.get(kind);
  if (!builtin) throw new Error(`${kind} isn't a kind built into Studio.`);
  const own: KindCandidate = { pluginId: builtin.pluginId, name: "Studio", kindId: kind, label: builtin.label };
  const alternatives = replacements(providers, kind);
  const choice = settings.use[kind] ?? null;
  if (choice === BUILTIN_CHOICE) return { kind, active: own, reason: "chosen", alternatives, choice };
  const chosen = choice ? alternatives.find((each) => each.pluginId === choice) : undefined;
  if (chosen) return { kind, active: chosen, reason: "chosen", alternatives, choice };
  if (alternatives.length === 1) return { kind, active: alternatives[0]!, reason: "only-replacement", alternatives, choice };
  return { kind, active: own, reason: "built-in", alternatives, choice };
}

export function resolveKinds(providers: readonly ProviderView[], settings: KindSettings): KindRoute[] {
  return BUILTIN_KINDS.map((each) => resolveKind(each.kind, providers, settings));
}

/**
 * Providers as Studio shows them: built-ins that are off left out, and for
 * each built-in kind only the chosen candidate offers New. Everything else
 * (opening, renaming, moving existing items) is unchanged.
 */
export function routeProviders(providers: readonly ProviderView[], settings: KindSettings): ProviderView[] {
  const visible = providers.filter((provider) => builtinOn(settings, provider.pluginId));
  const routes = resolveKinds(visible, settings);
  const losers = new Set<string>();
  for (const route of routes) {
    const own = BY_KIND.get(route.kind)!;
    const candidates = [{ pluginId: own.pluginId, kindId: route.kind }, ...route.alternatives];
    for (const candidate of candidates) {
      if (candidate.pluginId !== route.active.pluginId || candidate.kindId !== route.active.kindId) losers.add(`${candidate.pluginId}:${candidate.kindId}`);
    }
  }
  if (!losers.size) return visible;
  return visible.map((provider) => ({
    ...provider,
    kinds: provider.kinds.map((each) => losers.has(`${provider.pluginId}:${each.id}`)
      ? { ...each, create: null, ...(each.capabilities ? { capabilities: { ...each.capabilities, create: false } } : {}) }
      : each),
  }));
}

/**
 * Lines for agents: which provider makes new items of a built-in kind when
 * another one replaces it. Empty when every kind is Studio's own.
 */
export function routingInstructions(routes: readonly KindRoute[], settings: KindSettings): string {
  const lines: string[] = [];
  for (const route of routes) {
    const builtin = BY_KIND.get(route.kind)!;
    const external = route.active.pluginId !== builtin.pluginId;
    const off = settings.off.includes(route.kind);
    if (external) {
      lines.push(`- New ${builtin.label.toLowerCase()}: the user makes them with ${route.active.name} (${route.active.label}, plugin ${route.active.pluginId}). Create new ones there, not with Studio's ${route.kind} tools${off ? "" : `; ${builtin.label.toLowerCase()} already in Studio still open and edit there`}.`);
    } else if (off) {
      lines.push(`- ${builtin.label} are turned off in Studio; don't offer to make them.`);
    }
  }
  return lines.length ? ["BB Studio kinds:", ...lines].join("\n") : "";
}

/** The built-in kinds whose frontend entries Studio drops (off, or New routed to another provider). */
export interface KindFrontend {
  off: string[];
  /** Kinds whose New and composer entries go to another provider. */
  routedAway: string[];
}

export function frontendState(routes: readonly KindRoute[], settings: KindSettings): KindFrontend {
  return {
    off: [...settings.off],
    routedAway: routes.filter((route) => route.active.pluginId !== BY_KIND.get(route.kind)!.pluginId).map((route) => route.kind),
  };
}
