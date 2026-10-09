import { workspaceItemPath, type WorkspaceItem, type WorkspacePlacement } from "@bb-studio/kit/app";
export interface Tab { href: string; title: string }
export interface Pane { kind: "pane"; id: string; tabs: Tab[]; active: string | null }
export interface Split { kind: "split"; id: string; axis: "row" | "column"; ratio: number; first: Layout; second: Layout }
export type Layout = Pane | Split;
export interface Workspace { layout: Layout; focused: string }
let sequence = 0;
const id = () => `pane-${Date.now().toString(36)}-${++sequence}`;
export const emptyPane = (): Pane => ({ kind: "pane", id: id(), tabs: [], active: null });
export function emptyWorkspace(): Workspace { const layout = emptyPane(); return { layout, focused: layout.id }; }
export function panes(layout: Layout): Pane[] { return layout.kind === "pane" ? [layout] : [...panes(layout.first), ...panes(layout.second)]; }
export function mapLayout(layout: Layout, fn: (node: Layout) => Layout): Layout {
  return fn(layout.kind === "pane" ? layout : { ...layout, first: mapLayout(layout.first, fn), second: mapLayout(layout.second, fn) });
}
function remove(layout: Layout, href: string): Layout {
  if (layout.kind === "pane") {
    const index = layout.tabs.findIndex(tab => tab.href === href);
    const tabs = layout.tabs.filter(tab => tab.href !== href);
    return { ...layout, tabs, active: layout.active === href ? (tabs[Math.min(index, tabs.length - 1)]?.href ?? null) : layout.active };
  }
  const first = remove(layout.first, href), second = remove(layout.second, href);
  if (first.kind === "pane" && !first.tabs.length) return second;
  if (second.kind === "pane" && !second.tabs.length) return first;
  return { ...layout, first, second };
}
export function closeTab(state: Workspace, href: string): Workspace {
  const layout = remove(state.layout, href);
  return { layout, focused: panes(layout).some(pane => pane.id === state.focused) ? state.focused : panes(layout)[0]!.id };
}
export function openItem(state: Workspace, item: WorkspaceItem, placement: WorkspacePlacement = "tab", destination?: string, before?: string): Workspace {
  const href = workspaceItemPath(item.href);
  if (!href) return state;
  const existing = panes(state.layout).find(pane => pane.tabs.some(tab => tab.href === href));
  const tab: Tab = { href, title: item.title || existing?.tabs.find(tab => tab.href === href)?.title || href.split("/").pop()!.replace(/_/g, " ") };
  // Ordinary opening deduplicates; an explicit destination moves/reorders.
  if (existing && placement === "tab" && destination === undefined) {
    return { focused: existing.id, layout: mapLayout(state.layout, node => node.kind === "pane" && node.id === existing.id ? { ...node, active: href, tabs: node.tabs.map(each => each.href === href ? tab : each) } : node) };
  }
  if (before === href && existing?.id === destination) return state;
  destination ??= state.focused;
  if (placement !== "tab" && panes(state.layout).length >= 8) placement = "tab";
  let layout = state.layout;
  // Remove without collapsing first: the destination must survive a move.
  layout = mapLayout(layout, node => node.kind !== "pane" ? node : { ...node, tabs: node.tabs.filter(each => each.href !== href), active: node.active === href ? node.tabs.find(each => each.href !== href)?.href ?? null : node.active });
  const target = panes(layout).find(pane => pane.id === destination) ?? panes(layout)[0]!;
  let focused = target.id;
  layout = mapLayout(layout, node => {
    if (node.id !== target.id || node.kind !== "pane") return node;
    if (placement === "tab" || !node.tabs.length) {
      const tabs = [...node.tabs];
      const index = before ? tabs.findIndex(each => each.href === before) : -1;
      tabs.splice(index < 0 ? tabs.length : index, 0, tab);
      return { ...node, tabs, active: href };
    }
    const next = { ...emptyPane(), tabs: [tab], active: href };
    focused = next.id;
    const leading = placement === "left" || placement === "top";
    return { kind: "split", id: id(), axis: placement === "left" || placement === "right" ? "row" : "column", ratio: 0.5, first: leading ? next : node, second: leading ? node : next };
  });
  const collapse = (node: Layout): Layout => {
    if (node.kind === "pane") return node;
    if (node.first.kind === "pane" && !node.first.tabs.length) return node.second;
    if (node.second.kind === "pane" && !node.second.tabs.length) return node.first;
    return node;
  };
  return { layout: mapLayout(layout, collapse), focused };
}
/** Local storage is untrusted, and old/duplicate layouts should never mount editors twice. */
export function parseWorkspace(value: unknown): Workspace {
  const seen = new Set<string>(), ids = new Set<string>();
  function parse(value: any, depth = 0): Layout {
    if (!value || depth > 6 || typeof value.id !== "string" || ids.has(value.id)) throw new Error("Invalid pane");
    ids.add(value.id);
    if (value.kind === "split" && ["row", "column"].includes(value.axis)) return { kind: "split", id: value.id, axis: value.axis, ratio: Number.isFinite(value.ratio) ? Math.min(.8, Math.max(.2, value.ratio)) : .5, first: parse(value.first, depth + 1), second: parse(value.second, depth + 1) };
    if (value.kind !== "pane" || !Array.isArray(value.tabs) || value.tabs.length > 100) throw new Error("Invalid tabs");
    const tabs: Tab[] = [];
    for (const tab of value.tabs) {
      if (typeof tab?.href !== "string" || typeof tab.title !== "string") continue;
      const href = workspaceItemPath(tab.href);
      if (!href || seen.has(href)) continue;
      seen.add(href); tabs.push({ href, title: tab.title.slice(0, 300) });
    }
    return { kind: "pane", id: value.id, tabs, active: tabs.some(tab => tab.href === value.active) ? value.active : tabs[0]?.href ?? null };
  }
  try {
    const record = value as Workspace;
    const layout = parse(record.layout);
    return { layout, focused: panes(layout).some(pane => pane.id === record.focused) ? record.focused : panes(layout)[0]!.id };
  } catch { return emptyWorkspace(); }
}
