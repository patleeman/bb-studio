// The Studio tab in a thread's workbench (one panel action for every kind):
// what its params mean, which kinds it shows, and how the old per-kind tab
// ids map onto it. Pure, so cards, app.tsx and tests share it.
import { ARTIFACT_ICON, ARTIFACTS_TAB, PLUGIN_ID as ARTIFACTS_PLUGIN, REALTIME_CHANNEL as ARTIFACTS_CHANNEL, isArtifactId } from "../../artifacts/shared";
import { DASHBOARD_ICON, DASHBOARD_KIND, DASHBOARD_TAB, PLUGIN_ID as DASHBOARDS_PLUGIN, REALTIME_CHANNEL as DASHBOARDS_CHANNEL, isDashboardId } from "../../dashboards/shared";
import { DESIGN_ICON, DESIGN_TAB, PLUGIN_ID as DESIGN_PLUGIN, REALTIME_CHANNEL as DESIGN_CHANNEL, isDesignId } from "../../design/shared";
import { DRAW_ICON, DRAWINGS_TAB, PLUGIN_ID as DRAW_PLUGIN, REALTIME_CHANNEL as DRAW_CHANNEL, isDrawingId } from "../../draw/shared";
import { PLUGIN_ID as PAGES_PLUGIN, REALTIME_CHANNEL as PAGES_CHANNEL, isPageId } from "../../pages/constants";

/** The Studio tab's action id. */
export const STUDIO_TAB = "studio";
export const STUDIO_TAB_ICON = "studio/studio";
/** The old Pages tab's id; its persisted tabs still open (as the Studio tab). */
export const PAGE_TAB = "page";

export type TabKind = "page" | "drawing" | "design" | "dashboard" | "artifact";

export interface TabKindInfo {
  kind: TabKind;
  /** Studio's item namespace for the kind. */
  pluginId: string;
  channel: string;
  label: string;
  plural: string;
  icon: string;
  isId(id: string): boolean;
  /** The old per-kind tab's action id, and the param it took the item in. */
  legacyAction: string;
  legacyParam: string;
}

/** Kinds the Studio tab can open in place, in its filter order. */
export const TAB_KINDS: readonly TabKindInfo[] = [
  { kind: "page", pluginId: PAGES_PLUGIN, channel: PAGES_CHANNEL, label: "Page", plural: "Pages", icon: "studio/pages", isId: isPageId, legacyAction: PAGE_TAB, legacyParam: "pageId" },
  { kind: "drawing", pluginId: DRAW_PLUGIN, channel: DRAW_CHANNEL, label: "Drawing", plural: "Drawings", icon: DRAW_ICON, isId: isDrawingId, legacyAction: DRAWINGS_TAB, legacyParam: "drawingId" },
  { kind: "design", pluginId: DESIGN_PLUGIN, channel: DESIGN_CHANNEL, label: "Design", plural: "Designs", icon: DESIGN_ICON, isId: isDesignId, legacyAction: DESIGN_TAB, legacyParam: "designId" },
  { kind: DASHBOARD_KIND as "dashboard", pluginId: DASHBOARDS_PLUGIN, channel: DASHBOARDS_CHANNEL, label: "Dashboard", plural: "Dashboards", icon: DASHBOARD_ICON, isId: isDashboardId, legacyAction: DASHBOARD_TAB, legacyParam: "dashboardId" },
  { kind: "artifact", pluginId: ARTIFACTS_PLUGIN, channel: ARTIFACTS_CHANNEL, label: "Artifact", plural: "Artifacts", icon: ARTIFACT_ICON, isId: isArtifactId, legacyAction: ARTIFACTS_TAB, legacyParam: "artifactId" },
];

export function tabKind(kind: string): TabKindInfo | null {
  return TAB_KINDS.find((each) => each.kind === kind) ?? null;
}

/** The tab kinds still on (Setup → Kinds). */
export function enabledKinds(off: ReadonlySet<string>): TabKindInfo[] {
  return TAB_KINDS.filter((each) => !off.has(each.kind));
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
export function aliasParams(actionId: string, params: Params): { target: TabTarget; filter: TabKind | null } {
  const info = TAB_KINDS.find((each) => each.legacyAction === actionId) ?? null;
  const value = record(params);
  // The old Artifacts tab was the save picker unless a card opened it on one.
  if (info?.kind === "artifact" && typeof value?.artifactId !== "string") return { target: { view: "save", seq: seqOf(value?.seq) }, filter: null };
  const target = tabTarget(params);
  return { target, filter: target.view === "list" ? (info?.kind ?? null) : null };
}

/** The params a card or note opens the Studio tab with. */
export function itemParams(kind: TabKind, id: string): StudioTabParams {
  return { kind, id };
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
 * project; with a query, every matching item. Only enabled tab kinds, and
 * only `filter`'s when set.
 */
export function tabSections<T extends ListedItem>(
  items: readonly T[],
  options: { enabled: readonly TabKindInfo[]; filter: string | null; query: string; linked: ReadonlySet<string>; projectId: string | null },
): { title: string; items: T[] }[] {
  const kinds = new Map(options.enabled.map((each) => [each.kind as string, each.pluginId]));
  const live = items
    .filter((item) => kinds.get(item.kind) === item.pluginId && (!options.filter || item.kind === options.filter) && !item.archived && !item.template)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const words = options.query.toLowerCase().split(/\s+/).filter(Boolean);
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
