// The Studio tab in a thread's workbench: what its params mean and which
// kinds it shows. Pure, so cards, app.tsx and tests share it.
import { ARTIFACT_ICON, PLUGIN_ID as ARTIFACTS_PLUGIN, REALTIME_CHANNEL as ARTIFACTS_CHANNEL, isArtifactId } from "../../artifacts/shared";
import { DESIGN_ICON, PLUGIN_ID as DESIGN_PLUGIN, REALTIME_CHANNEL as DESIGN_CHANNEL, isDesignId } from "../../design/shared";
import { DRAW_ICON, PLUGIN_ID as DRAW_PLUGIN, REALTIME_CHANNEL as DRAW_CHANNEL, isDrawingId } from "../../draw/shared";
import { MINI_ICON, PLUGIN_ID as MINIS_PLUGIN, REALTIME_CHANNEL as MINIS_CHANNEL, isMiniId } from "../../minis/shared";
import { PLUGIN_ID as PAGES_PLUGIN, REALTIME_CHANNEL as PAGES_CHANNEL, isPageId } from "../../pages/constants";
import { PLUGIN_ID as TALK_PLUGIN, RECORDING_CHANGED, TALK_ICON, isRecordingId } from "../../talk/shared/format";
import { BUILTIN_PLUGIN_IDS } from "../../builtins";
import { familyNamed, ITEM_FAMILIES as MODEL_FAMILIES, itemType, typeNamed, typeOfKind, type ItemFamily } from "../../item-model";

/** The Studio tab's action id. */
export const STUDIO_TAB = "studio";
export const STUDIO_TAB_ICON = "studio/studio";
export type TabKind = "page" | "drawing" | "design" | "mini" | "artifact" | "recording" | "dictation";

/**
 * The two kinds of thing Studio makes (src/item-model.ts). Pages are
 * documents: docs, whiteboards and designs. Apps are things that run: mini
 * apps and artifacts. Recordings belong to neither. `types` are
 * what filters keep; `kinds` are the same types by the kind name providers
 * report.
 */
export type { ItemFamily };
export const ITEM_FAMILIES: readonly { id: ItemFamily; label: string; types: readonly string[]; kinds: readonly string[] }[] =
  MODEL_FAMILIES.map((family) => ({ id: family.id, label: family.plural, types: family.types, kinds: family.types.map((type) => itemType(type)!.kind) }));
/** The family of a type or of the kind name it had ("doc" or "page", "whiteboard" or "drawing"), or null (recordings, kinds from add-ons). */
export function familyOf(kind: string): ItemFamily | null {
  return typeNamed(kind)?.family ?? null;
}
/** `selected` types after toggling a whole family: all of its present types on, or all off when they were all on. */
export function toggleFamily(selected: readonly string[], family: ItemFamily, present: readonly string[]): string[] {
  const types = (ITEM_FAMILIES.find((each) => each.id === family)?.types ?? []).filter((type) => present.includes(type));
  const allOn = types.length > 0 && types.every((type) => selected.includes(type));
  return allOn ? selected.filter((type) => !types.includes(type)) : [...new Set([...selected, ...types])];
}

export interface TabKindInfo {
  kind: TabKind;
  /** Studio's item namespace for the kind. */
  pluginId: string;
  channel: string;
  label: string;
  plural: string;
  icon: string;
  isId(id: string): boolean;
  /** The built-in kind (Setup → Kinds) that turns this one off. */
  gate: string;
  /** Kept out of All, as in Studio's library; its chip and search still find it. */
  background?: boolean;
}

/** Kinds the Studio tab can open in place, in its filter order. */
export const TAB_KINDS: readonly TabKindInfo[] = [
  { kind: "page", pluginId: PAGES_PLUGIN, channel: PAGES_CHANNEL, label: "Page", plural: "Pages", icon: "studio/pages", isId: isPageId, gate: "page" },
  { kind: "drawing", pluginId: DRAW_PLUGIN, channel: DRAW_CHANNEL, label: "Whiteboard", plural: "Whiteboards", icon: DRAW_ICON, isId: isDrawingId, gate: "drawing" },
  { kind: "design", pluginId: DESIGN_PLUGIN, channel: DESIGN_CHANNEL, label: "Design", plural: "Designs", icon: DESIGN_ICON, isId: isDesignId, gate: "design" },
  { kind: "mini", pluginId: MINIS_PLUGIN, channel: MINIS_CHANNEL, label: "App", plural: "Apps", icon: MINI_ICON, isId: isMiniId, gate: "mini" },
  { kind: "artifact", pluginId: ARTIFACTS_PLUGIN, channel: ARTIFACTS_CHANNEL, label: "Artifact", plural: "Artifacts", icon: ARTIFACT_ICON, isId: isArtifactId, gate: "artifact" },
  { kind: "recording", pluginId: TALK_PLUGIN, channel: RECORDING_CHANGED, label: "Recording", plural: "Recordings", icon: TALK_ICON, isId: isRecordingId, gate: "recording" },
  { kind: "dictation", pluginId: TALK_PLUGIN, channel: RECORDING_CHANGED, label: "Dictation", plural: "Dictations", icon: "Mic", isId: isRecordingId, gate: "recording", background: true },
];

/**
 * The tab kind a name means. Besides a tab kind's own name ("design"), it
 * reads a type ("doc", "whiteboard") and, with the item's id, a family: `page`
 * with a design's id is the design kind, `app` with an artifact's the
 * artifact kind. So `{ kind: "page", id }` opens any page type and
 * `{ kind: "app", id }` any app type, and the older `{ kind: "design", id }`
 * still opens what it did.
 */
export function tabKind(kind: string, id?: string): TabKindInfo | null {
  const exact = TAB_KINDS.find((each) => each.kind === kind) ?? null;
  if (exact && (id === undefined || exact.isId(id))) return exact;
  const family = familyNamed(kind);
  if (family && id !== undefined) return TAB_KINDS.find((each) => typeOfKind(each.pluginId, each.kind)?.family === family && each.isId(id)) ?? exact;
  if (exact) return exact;
  const type = typeNamed(kind);
  return type ? TAB_KINDS.find((each) => each.pluginId === type.pluginId && each.kind === type.kind) ?? null : null;
}

/** The tab kinds still on (Setup → Kinds). */
export function enabledKinds(off: ReadonlySet<string>): TabKindInfo[] {
  return TAB_KINDS.filter((each) => !off.has(each.gate));
}

/** What the tab shows first. */
export type TabTarget =
  | { view: "list" }
  | { view: "item"; kind: TabKind; id: string }
  /** Artifacts' save picker: a reply's files (`seq`, else the latest reply). */
  | { view: "save"; seq: number | null };

/** What the Studio tab opens with: `{ kind, id }`, `{ view: "save", seq? }` or nothing. */
export type StudioTabParams = { kind: TabKind; id: string } | { view: "save"; seq?: number } | null;

type Params = unknown;
const seqOf = (seq: unknown) => (typeof seq === "number" && Number.isInteger(seq) && seq >= 0 ? seq : null);
const record = (params: Params): Record<string, unknown> | null =>
  params && typeof params === "object" && !Array.isArray(params) ? (params as Record<string, unknown>) : null;

/**
 * Where params land. A kind that's off, or an id that isn't that kind's,
 * opens the list.
 */
export function tabTarget(params: Params, enabled: readonly TabKindInfo[] = TAB_KINDS): TabTarget {
  const value = record(params);
  if (!value) return { view: "list" };
  const on = (kind: string, id?: string) => { const info = tabKind(kind, id); return info && enabled.some((each) => each.kind === info.kind) ? info : null; };
  if (value.view === "save") return on("artifact") ? { view: "save", seq: seqOf(value.seq) } : { view: "list" };
  if (typeof value.kind === "string" && typeof value.id === "string") {
    // The kind may be the family or the type: the id says which editor.
    const info = on(value.kind, value.id);
    return info?.isId(value.id) ? { view: "item", kind: info.kind, id: value.id } : { view: "list" };
  }
  return { view: "list" };
}

/**
 * The params a card or note opens the Studio tab with. `kind` may be a tab
 * kind, a type or a family ("page", "app"); the params carry the tab kind,
 * which every BB and every saved tab already reads.
 */
export function itemParams(kind: TabKind | "app" | "doc" | "whiteboard", id: string): StudioTabParams {
  return { kind: tabKind(kind, id)?.kind ?? (kind as TabKind), id };
}

/** A kind's chip and filter id: `pluginId:kind`, since add-ons may reuse a kind id. */
export const kindKey = (kind: { pluginId: string; kind: string }): string => `${kind.pluginId}:${kind.kind}`;

/** A kind the collection lists: Studio's tab kinds, then every add-on kind. */
export interface CollectionKind {
  key: string;
  pluginId: string;
  kind: string;
  label: string;
  plural: string;
  icon: string;
  background: boolean;
  /** Opens in place in the tab; null opens the item's page in BB's main area. */
  tab: TabKindInfo | null;
  /** On the New menu: made by RPC and opened in place. */
  creatable: boolean;
}

export interface ProviderKinds {
  pluginId: string;
  state?: string;
  kinds: readonly { id: string; label: string; plural: string; icon: string; background?: boolean; create?: { mode: string } | null }[];
}

/**
 * Every kind the collection shows, in chip order: the enabled tab kinds, then
 * each kind a ready add-on provider registered with Studio. Add-ons need no
 * code here; a new one shows up with its own chip.
 */
export function collectionKinds(enabled: readonly TabKindInfo[], providers: readonly ProviderKinds[]): CollectionKind[] {
  const described = new Map<string, ProviderKinds["kinds"][number]>(providers.flatMap((provider) => provider.kinds.map((kind) => [`${provider.pluginId}:${kind.id}`, kind] as const)));
  const own = enabled.map((info): CollectionKind => ({
    key: kindKey(info),
    pluginId: info.pluginId,
    kind: info.kind,
    label: info.label,
    plural: info.plural,
    icon: info.icon,
    background: Boolean(info.background),
    tab: info,
    creatable: described.get(kindKey(info))?.create?.mode === "rpc",
  }));
  const addOns = providers
    .filter((provider) => provider.state !== "offline" && !BUILTIN_PLUGIN_IDS.has(provider.pluginId))
    .flatMap((provider) => provider.kinds.map((kind): CollectionKind => ({
      key: `${provider.pluginId}:${kind.id}`,
      pluginId: provider.pluginId,
      kind: kind.id,
      label: kind.label,
      plural: kind.plural,
      icon: kind.icon,
      background: Boolean(kind.background),
      tab: null,
      creatable: false,
    })));
  return [...own, ...addOns];
}

/** How a listed item opens: in place for a tab kind, else its page in BB's main area. */
export function itemOpening(item: { pluginId: string; kind: string; id: string; href: string }, kinds: readonly CollectionKind[]): { open: "tab"; kind: TabKind; id: string } | { open: "page"; href: string } | null {
  const kind = kinds.find((each) => each.key === kindKey(item));
  if (!kind) return null;
  if (kind.tab?.isId(item.id)) return { open: "tab", kind: kind.tab.kind, id: item.id };
  return { open: "page", href: item.href };
}

export interface ListedItem {
  pluginId: string;
  id: string;
  kind: string;
  family?: string;
  type?: string;
  title: string;
  preview?: string | null;
  archived?: boolean;
  template?: boolean;
  projectId?: string | null;
  updatedAt: number;
}
