// The Studio tab in a thread's workbench (one panel action for every kind):
// what its params mean, which kinds it shows, and how the old per-kind tab
// ids map onto it. Pure, so cards, app.tsx and tests share it.
import { ARTIFACT_ICON, ARTIFACTS_TAB, PLUGIN_ID as ARTIFACTS_PLUGIN, REALTIME_CHANNEL as ARTIFACTS_CHANNEL, isArtifactId } from "../../artifacts/shared";
import { DASHBOARD_ICON, DASHBOARD_KIND, DASHBOARD_TAB, PLUGIN_ID as DASHBOARDS_PLUGIN, REALTIME_CHANNEL as DASHBOARDS_CHANNEL, isDashboardId } from "../../dashboards/shared";
import { DESIGN_ICON, DESIGN_TAB, PLUGIN_ID as DESIGN_PLUGIN, REALTIME_CHANNEL as DESIGN_CHANNEL, isDesignId } from "../../design/shared";
import { DRAW_ICON, DRAWINGS_TAB, PLUGIN_ID as DRAW_PLUGIN, REALTIME_CHANNEL as DRAW_CHANNEL, isDrawingId } from "../../draw/shared";
import { PLUGIN_ID as PAGES_PLUGIN, REALTIME_CHANNEL as PAGES_CHANNEL, isPageId } from "../../pages/constants";
import { PLUGIN_ID as TALK_PLUGIN, RECORDING_CHANGED, TALK_ICON, isRecordingId } from "../../talk/shared/format";
import { BUILTIN_PLUGIN_IDS } from "../../builtins";

/** The Studio tab's action id. */
export const STUDIO_TAB = "studio";
export const STUDIO_TAB_ICON = "studio/studio";
/** The old Pages tab's id; its persisted tabs still open (as the Studio tab). */
export const PAGE_TAB = "page";

export type TabKind = "page" | "drawing" | "design" | "dashboard" | "artifact" | "recording" | "dictation";

export interface TabKindInfo {
  kind: TabKind;
  /** Studio's item namespace for the kind. */
  pluginId: string;
  channel: string;
  label: string;
  plural: string;
  icon: string;
  isId(id: string): boolean;
  /** The old per-kind tab's action id, and the param it took the item in (none for kinds that never had a tab). */
  legacyAction: string | null;
  legacyParam: string | null;
  /** The built-in kind (Setup → Kinds) that turns this one off. */
  gate: string;
  /** Kept out of All, as in Studio's library; its chip and search still find it. */
  background?: boolean;
}

/** Kinds the Studio tab can open in place, in its filter order. */
export const TAB_KINDS: readonly TabKindInfo[] = [
  { kind: "page", pluginId: PAGES_PLUGIN, channel: PAGES_CHANNEL, label: "Page", plural: "Pages", icon: "studio/pages", isId: isPageId, legacyAction: PAGE_TAB, legacyParam: "pageId", gate: "page" },
  { kind: "drawing", pluginId: DRAW_PLUGIN, channel: DRAW_CHANNEL, label: "Drawing", plural: "Drawings", icon: DRAW_ICON, isId: isDrawingId, legacyAction: DRAWINGS_TAB, legacyParam: "drawingId", gate: "drawing" },
  { kind: "design", pluginId: DESIGN_PLUGIN, channel: DESIGN_CHANNEL, label: "Design", plural: "Designs", icon: DESIGN_ICON, isId: isDesignId, legacyAction: DESIGN_TAB, legacyParam: "designId", gate: "design" },
  { kind: DASHBOARD_KIND as "dashboard", pluginId: DASHBOARDS_PLUGIN, channel: DASHBOARDS_CHANNEL, label: "Dashboard", plural: "Dashboards", icon: DASHBOARD_ICON, isId: isDashboardId, legacyAction: DASHBOARD_TAB, legacyParam: "dashboardId", gate: "dashboard" },
  { kind: "artifact", pluginId: ARTIFACTS_PLUGIN, channel: ARTIFACTS_CHANNEL, label: "Artifact", plural: "Artifacts", icon: ARTIFACT_ICON, isId: isArtifactId, legacyAction: ARTIFACTS_TAB, legacyParam: "artifactId", gate: "artifact" },
  { kind: "recording", pluginId: TALK_PLUGIN, channel: RECORDING_CHANGED, label: "Recording", plural: "Recordings", icon: TALK_ICON, isId: isRecordingId, legacyAction: null, legacyParam: null, gate: "recording" },
  { kind: "dictation", pluginId: TALK_PLUGIN, channel: RECORDING_CHANGED, label: "Dictation", plural: "Dictations", icon: "Mic", isId: isRecordingId, legacyAction: null, legacyParam: null, gate: "recording", background: true },
];

export function tabKind(kind: string): TabKindInfo | null {
  return TAB_KINDS.find((each) => each.kind === kind) ?? null;
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
 * opens the list. The old tabs' params (`{ pageId }`, `{ seq }` …) still work.
 */
export function tabTarget(params: Params, enabled: readonly TabKindInfo[] = TAB_KINDS): TabTarget {
  const value = record(params);
  if (!value) return { view: "list" };
  const on = (kind: string) => enabled.find((each) => each.kind === kind) ?? null;
  if (value.view === "save") return on("artifact") ? { view: "save", seq: seqOf(value.seq) } : { view: "list" };
  if (typeof value.kind === "string" && typeof value.id === "string") {
    const info = on(value.kind);
    return info?.isId(value.id) ? { view: "item", kind: info.kind, id: value.id } : { view: "list" };
  }
  for (const info of enabled) {
    if (!info.legacyParam) continue;
    const id = value[info.legacyParam];
    if (typeof id === "string" && info.isId(id)) return { view: "item", kind: info.kind, id };
  }
  return { view: "list" };
}

/**
 * A tab BB restored under an old per-kind action id, as Studio tab params:
 * the item it showed, the save picker for the old Artifacts tab, or the list
 * of that kind.
 */
export function aliasParams(actionId: string, params: Params): { target: TabTarget; filter: string | null } {
  const info = TAB_KINDS.find((each) => each.legacyAction === actionId) ?? null;
  const value = record(params);
  // The old Artifacts tab was the save picker unless a card opened it on one.
  if (info?.kind === "artifact" && typeof value?.artifactId !== "string") return { target: { view: "save", seq: seqOf(value?.seq) }, filter: null };
  const target = tabTarget(params);
  return { target, filter: target.view === "list" && info ? kindKey(info) : null };
}

/** The params a card or note opens the Studio tab with. */
export function itemParams(kind: TabKind, id: string): StudioTabParams {
  return { kind, id };
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
  title: string;
  preview?: string | null;
  archived?: boolean;
  template?: boolean;
  projectId?: string | null;
  updatedAt: number;
}

const RECENT = 30;

/**
 * The collection: this thread's items, then recent ones in the thread's
 * project; with a query, every matching item. Only listed kinds, and only
 * `filter`'s (a kind key) when set. Background kinds (dictation) stay out of
 * All, as in Studio's library, but their chip and search find them.
 */
export function tabSections<T extends ListedItem>(
  items: readonly T[],
  options: { kinds: readonly CollectionKind[]; filter: string | null; query: string; linked: ReadonlySet<string>; projectId: string | null },
): { title: string; items: T[] }[] {
  const kinds = new Map<string, CollectionKind>(options.kinds.map((each) => [each.key, each]));
  const words = options.query.toLowerCase().split(/\s+/).filter(Boolean);
  const shows = (item: T) => {
    const kind = kinds.get(kindKey(item));
    if (!kind) return false;
    if (options.filter) return kind.key === options.filter;
    return !kind.background || words.length > 0;
  };
  const live = items
    .filter((item) => shows(item) && !item.archived && !item.template)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  if (words.length) {
    return [{ title: "Results", items: live.filter((item) => words.every((word) => `${item.title} ${item.preview ?? ""}`.toLowerCase().includes(word))) }];
  }
  const key = (item: ListedItem) => `${item.pluginId}:${item.id}`;
  const here = live.filter((item) => options.linked.has(key(item)));
  const recent = live
    .filter((item) => !options.linked.has(key(item)) && (!options.projectId || !item.projectId || item.projectId === options.projectId))
    .slice(0, RECENT);
  return [
    { title: "This thread", items: here },
    { title: "Recent", items: recent },
  ].filter((section) => section.items.length);
}
