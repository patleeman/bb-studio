import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { Icon, StudioBar, registerWorkspaceCloser, setWorkspaceActive, canOpenWorkspaceItem, openAppPath, publishWorkspaceAnchor, registerWorkspaceOpener, studioTargetAt, subscribeWorkspace, workspaceRevision, WORKSPACE_DRAG, WORKSPACE_PATH, type WorkspaceItem, type WorkspacePlacement } from "@bb-studio/kit/app";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@bb-studio/kit/ui";
import type { rpcContract } from "../contract";
import { BROWSE, closeTab, emptyWorkspace, mapLayout, openItem, panes, parseWorkspace, type Layout, type Pane, type Tab, type Workspace } from "./workspace-state";

const STORAGE = "bb:studio-workspace:v1";
let state: Workspace | undefined;
const listeners = new Set<() => void>();
function snapshot() {
  if (!state) { try { state = parseWorkspace(JSON.parse(localStorage.getItem(STORAGE) ?? "null")); } catch { state = emptyWorkspace(); } }
  return state;
}
function update(fn: (current: Workspace) => Workspace) {
  state = fn(snapshot());
  try { localStorage.setItem(STORAGE, JSON.stringify(state)); } catch { /* Editing still works with storage disabled. */ }
  listeners.forEach(listener => listener());
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useWorkspace = () => useSyncExternalStore(subscribe, snapshot, snapshot);
/** Shows the new tab page, Studio's item list: focused where it is open, else in the focused pane. */
export function showBrowse(pane?: string) {
  update(current => openItem(current, BROWSE, "tab", pane));
}
export function closeWorkspaceTabs(hrefs: readonly string[]) {
  update(current => hrefs.reduce((next, href) => closeTab(next, href), current));
}
// While a Studio item is dragged anywhere, each pane lays a drop layer over its
// editor: an editor in an iframe, or one that handles drags itself, would
// otherwise swallow them. `source` is the tab being dragged, if it is one.
let dragging: { source: string | null } | null = null;
const dragListeners = new Set<() => void>();
function setDragging(next: typeof dragging) { if (next?.source !== dragging?.source || !next !== !dragging) { dragging = next; dragListeners.forEach(listener => listener()); } }
const useDragging = () => useSyncExternalStore(listener => { dragListeners.add(listener); return () => { dragListeners.delete(listener); }; }, () => dragging, () => null);
const BUTTON = "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";

/** Installed once by Studio; without Studio, add-ons keep their ordinary pages. */
export function WorkspaceBridge() {
  const rpc = useRpc<typeof rpcContract>();
  useEffect(() => registerWorkspaceCloser(href => closeWorkspaceTabs([href])), []);
  useEffect(() => {
    const publish = () => { const current = snapshot(); setWorkspaceActive(panes(current.layout).find(pane => pane.id === current.focused)?.active ?? null); };
    publish();
    return subscribe(publish);
  }, []);
  useEffect(() => registerWorkspaceOpener((item, placement) => {
    update(current => openItem(current, item, placement));
    openAppPath(WORKSPACE_PATH, { standalone: true });
    // The server's item title takes precedence over IDs and stale link labels.
    void rpc.call("visitTab", { path: item.href }).then(({ tab }) => {
      if (!tab) return;
      update(current => ({ ...current, layout: mapLayout(current.layout, node => node.kind === "pane" ? { ...node, tabs: node.tabs.map(each => each.href === item.href ? { ...each, title: tab.title, icon: tab.icon, kindIcon: tab.kindIcon } : each) } : node) }));
    }, () => {});
  }), [rpc]);
  useEffect(() => {
    let previous = panes(snapshot().layout).flatMap(pane => pane.tabs);
    return subscribe(() => {
      const next = panes(snapshot().layout).flatMap(pane => pane.tabs);
      const removed = previous.filter(tab => !next.some(each => each.href === tab.href));
      previous = next;
      if (removed.length) void rpc.call("tabs", null).then(({ tabs }) => {
        const open = new Set(panes(snapshot().layout).flatMap(pane => pane.tabs.map(tab => tab.href)));
        const items = tabs.filter(tab => removed.some(each => each.href === tab.href) && !open.has(tab.href)).map(tab => ({ pluginId: tab.pluginId, id: tab.id }));
        if (items.length) return rpc.call("closeTabs", { items });
      }).catch(() => {});
    });
  }, [rpc]);
  useEffect(() => {
    const drag = (event: globalThis.DragEvent) => {
      const element = event.target instanceof Element ? event.target : null;
      // Text selection and editor-native drags retain their own behavior.
      if (element?.closest("[contenteditable=true], textarea, input, [data-studio-workspace-tab]")) return;
      const target = studioTargetAt(element);
      if (target?.kind !== "path" || !canOpenWorkspaceItem(target.path) || !event.dataTransfer) return;
      event.dataTransfer.setData(WORKSPACE_DRAG, JSON.stringify({ href: target.path, title: target.title }));
      event.dataTransfer.effectAllowed = "copyMove";
    };
    document.addEventListener("dragstart", drag);
    // Drags from the sidebar, another window or a tab all pass here first.
    const enter = (event: globalThis.DragEvent) => { if (accepts(event) && !dragging) setDragging({ source: null }); };
    const end = () => setDragging(null);
    // Leaving for nothing: out of the window, into a frame, or cancelled. A
    // drag that comes back enters again; a pointer moving means it's over.
    const leave = (event: globalThis.DragEvent) => { if (!event.relatedTarget) end(); };
    const moved = () => { if (dragging) end(); };
    document.addEventListener("dragenter", enter, true);
    document.addEventListener("dragleave", leave, true);
    document.addEventListener("dragend", end, true);
    document.addEventListener("pointermove", moved, true);
    // Bubbling, so a pane's drop layer handles the drop before it goes.
    window.addEventListener("drop", end);
    return () => {
      document.removeEventListener("dragstart", drag);
      document.removeEventListener("dragenter", enter, true);
      document.removeEventListener("dragleave", leave, true);
      document.removeEventListener("dragend", end, true);
      document.removeEventListener("pointermove", moved, true);
      window.removeEventListener("drop", end);
    };
  }, []);
  return null;
}

function dragged(event: Pick<globalThis.DragEvent, "dataTransfer">): WorkspaceItem | null {
  try {
    const value = JSON.parse(event.dataTransfer?.getData(WORKSPACE_DRAG) ?? "");
    return typeof value?.href === "string" && (canOpenWorkspaceItem(value.href) || value.href === BROWSE.href) ? { href: value.href, ...(typeof value.title === "string" ? { title: value.title } : {}) } : null;
  } catch { return null; }
}
function accepts(event: Pick<globalThis.DragEvent, "dataTransfer">) { return event.dataTransfer?.types.includes(WORKSPACE_DRAG) ?? false; }
function move(item: WorkspaceItem, pane: string, placement: WorkspacePlacement, before?: string) {
  update(current => openItem(current, item, placement, pane, before));
}
function select(pane: string, href: string) {
  update(current => ({ focused: pane, layout: mapLayout(current.layout, node => node.kind === "pane" && node.id === pane ? { ...node, active: href } : node) }));
}
const barSlot = (instance: string, href: string) => `${instance}${href}`;
function EditorSlot({ tab, instance }: { tab: Tab; instance: string }) {
  const element = useRef<HTMLDivElement>(null);
  useSyncExternalStore(subscribeWorkspace, workspaceRevision, () => 0);
  const available = canOpenWorkspaceItem(tab.href) || tab.href === BROWSE.href;
  useLayoutEffect(() => {
    if (!element.current) return;
    return publishWorkspaceAnchor({ id: `workspace:${instance}:${tab.href}`, path: tab.href, element: element.current });
  }, [tab.href, instance]);
  // The item's tools go to its slot in the tab row (barSlot), not a bar of its own.
  return <div data-studio-workspace-frame={barSlot(instance, tab.href)} className="flex min-h-0 min-w-0 flex-1 flex-col">
    {!available && <div className="p-6 text-sm text-muted-foreground">This item's plugin is unavailable. Enable it to reopen this tab. <button className="underline" onClick={() => openAppPath(tab.href, { standalone: true })}>Open item page</button></div>}
    <div ref={element} data-studio-workspace-editor={tab.href} className="flex min-h-0 min-w-0 flex-1 flex-col" />
  </div>;
}
/** `titleBar`: the only pane, whose tab row takes BB's title bar instead of a row of its own. */
function TabPane({ pane, focused, instance, titleBar }: { pane: Pane; focused: string; instance: string; titleBar: boolean }) {
  const [drop, setDrop] = useState<WorkspacePlacement | null>(null);
  const active = pane.tabs.find(tab => tab.href === pane.active);
  const paneElement = useRef<HTMLElement>(null);
  const dropElement = useRef<HTMLDivElement>(null);
  const drag = useDragging();
  // A pane's only tab can't split its own pane or move into it.
  const own = !!drag?.source && pane.tabs.length === 1 && pane.tabs[0]!.href === drag.source;
  useEffect(() => { if (!drag) setDrop(null); }, [drag]);
  const place = (event: Pick<globalThis.DragEvent, "clientX" | "clientY">): WorkspacePlacement => {
    const rect = dropElement.current!.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width, y = (event.clientY - rect.top) / rect.height;
    return x < .22 ? "left" : x > .78 ? "right" : y < .22 ? "top" : y > .78 ? "bottom" : "tab";
  };
  // Native capture crosses the add-on's portal boundary; React handlers in
  // Studio's tree cannot reliably receive events from another plugin's tree.
  useEffect(() => {
    const element = paneElement.current!;
    const focus = () => { if (snapshot().focused !== pane.id) update(current => ({ ...current, focused: pane.id })); };
    element.addEventListener("pointerdown", focus, true);
    return () => element.removeEventListener("pointerdown", focus, true);
  }, [pane.id]);
  const tabRow = (
    <div data-studio-workspace-tabs="" className={`flex shrink-0 items-center gap-1 ${titleBar ? "h-full min-w-0 flex-1" : "h-10 border-b bg-background pl-1.5 pr-1"}`}
      onDragOver={event => { if (accepts(event)) { event.preventDefault(); event.stopPropagation(); } }}
      onDrop={event => { const item = dragged(event); if (item) { event.preventDefault(); event.stopPropagation(); move(item, pane.id, "tab"); } }}>
      <div role="tablist" aria-label="Studio items" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
        {pane.tabs.map((tab, index) => <div key={tab.href} onDragEnd={() => setDragging(null)} className={`group/tab flex h-7 max-w-56 shrink-0 items-center rounded-md transition-colors ${pane.active !== tab.href ? "text-muted-foreground hover:bg-state-hover hover:text-foreground" : focused === pane.id ? "bg-state-active text-foreground" : "bg-state-hover text-foreground"}`} data-studio-workspace-tab={tab.href} draggable onDragStart={event => { event.dataTransfer.setData(WORKSPACE_DRAG, JSON.stringify(tab)); event.dataTransfer.effectAllowed = "move"; setDragging({ source: tab.href }); }}
          onDragOver={event => { if (accepts(event)) event.preventDefault(); }}
          onDrop={event => { const item = dragged(event); if (item) { event.preventDefault(); event.stopPropagation(); move(item, pane.id, "tab", tab.href); } }}>
          <button role="tab" aria-selected={pane.active === tab.href} aria-controls={`view-${instance}-${pane.id}-${index}`} id={`tab-${instance}-${pane.id}-${index}`} tabIndex={pane.active === tab.href ? 0 : -1}
            className="flex h-full min-w-0 items-center gap-1.5 rounded-md pl-2 pr-0.5 text-[13px] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
            onClick={() => select(pane.id, tab.href)} onKeyDown={event => {
              const next = event.key === "ArrowRight" ? (index + 1) % pane.tabs.length : event.key === "ArrowLeft" ? (index + pane.tabs.length - 1) % pane.tabs.length : event.key === "Home" ? 0 : event.key === "End" ? pane.tabs.length - 1 : null;
              if (next !== null) { event.preventDefault(); select(pane.id, pane.tabs[next]!.href); document.getElementById(`tab-${instance}-${pane.id}-${next}`)?.focus(); }
              if (event.key === "Delete") { event.preventDefault(); update(current => closeTab(current, tab.href)); }
            }}>
            {tab.icon ? <span aria-hidden className="w-3.5 shrink-0 text-center text-xs leading-none">{tab.icon}</span> : <Icon name={tab.kindIcon ?? "File"} className="size-3.5 shrink-0 opacity-70" />}
            <span className="truncate">{tab.title}</span>
          </button>
          {/* Closing the last tab would only reopen the new tab page. */}
          {tab.href === BROWSE.href && panes(snapshot().layout).every(each => each.tabs.length === (each.id === pane.id ? 1 : 0)) ? <span className="w-1" /> : <button className={`mr-1 inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring group-hover/tab:opacity-100 pointer-coarse:opacity-100 ${pane.active === tab.href ? "" : "opacity-0"}`} aria-label={`Close ${tab.title}`} onClick={() => update(current => closeTab(current, tab.href))}><Icon name="X" className="size-3" /></button>}
        </div>)}
      </div>
      {pane.tabs.map(tab => <div key={tab.href} data-studio-workspace-bar={barSlot(instance, tab.href)} hidden={pane.active !== tab.href} className="flex min-w-0 shrink-0 items-center" />)}
      <button className={BUTTON} aria-label="Browse Studio items" title="Browse Studio items" onClick={() => showBrowse(pane.id)}><Icon name="Plus" className="size-4" /></button>
      {active && <DropdownMenu><DropdownMenuTrigger asChild><button className={BUTTON} aria-label="Arrange active tab" title="Split or move"><Icon name="Columns2" className="size-4" /></button></DropdownMenuTrigger><DropdownMenuContent align="end">
        {(["left", "right", "top", "bottom"] as const).map(edge => <DropdownMenuItem key={edge} disabled={pane.tabs.length < 2 || panes(snapshot().layout).length >= 8} onSelect={() => move(active, pane.id, edge)}>Split {edge}</DropdownMenuItem>)}
        {panes(snapshot().layout).filter(other => other.id !== pane.id).map((other, index) => <DropdownMenuItem key={other.id} onSelect={() => move(active, other.id, "tab")}>Move to pane {index + 1}</DropdownMenuItem>)}
        <DropdownMenuItem onSelect={() => update(current => closeTab(current, active.href))}>Close tab</DropdownMenuItem>
      </DropdownMenuContent></DropdownMenu>}
    </div>
  );
  return <section ref={paneElement} aria-label="Studio pane" data-workspace-pane={pane.id} className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
    {titleBar ? <StudioBar>{tabRow}</StudioBar> : tabRow}
    <div ref={dropElement} data-studio-workspace-drop="" className="relative flex min-h-0 flex-1 flex-col">
      {pane.tabs.map((tab, index) => <div key={tab.href} role="tabpanel" id={`view-${instance}-${pane.id}-${index}`} aria-labelledby={`tab-${instance}-${pane.id}-${index}`} hidden={pane.active !== tab.href} style={{ display: pane.active === tab.href ? "flex" : "none" }} className="min-h-0 min-w-0 flex-1 flex-col"><EditorSlot tab={tab} instance={instance} /></div>)}
      {!pane.tabs.length && <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-sm text-muted-foreground"><p>Open an item from the sidebar, or drop one here.</p><button className="rounded border px-3 py-2 text-foreground hover:bg-state-hover" onClick={() => showBrowse(pane.id)}>Browse Studio</button></div>}
      {drag && <div data-studio-workspace-drop-layer="" className="absolute inset-0 z-30"
        onDragOver={event => { if (own || !accepts(event)) return; event.preventDefault(); setDrop(place(event)); }}
        onDragLeave={() => setDrop(null)}
        onDrop={event => { setDrop(null); const item = own ? null : dragged(event); if (item) { event.preventDefault(); move(item, pane.id, place(event)); } }} />}
      {drop && <div className="pointer-events-none absolute z-20 flex items-center justify-center border-2 border-primary bg-primary/10 text-sm font-medium" style={{ inset: 0, ...(drop === "left" ? { right: "50%" } : drop === "right" ? { left: "50%" } : drop === "top" ? { bottom: "50%" } : drop === "bottom" ? { top: "50%" } : {}) }}>{drop === "tab" ? "Open as tab" : `Split ${drop}`}</div>}
    </div>
  </section>;
}
function LayoutView({ node, root, focused, compact, instance }: { node: Layout; root: Layout; focused: string; compact: boolean; instance: string }) {
  const container = useRef<HTMLDivElement>(null);
  if (node.kind === "pane") return <TabPane pane={node} focused={focused} instance={instance} titleBar={node === root} />;
  const resize = (ratio: number) => update(current => ({ ...current, layout: mapLayout(current.layout, each => each.id === node.id && each.kind === "split" ? { ...each, ratio: Math.max(.2, Math.min(.8, ratio)) } : each) }));
  return <div ref={container} className="flex h-full min-h-0 min-w-0 flex-1" style={{ flexDirection: node.axis }}>
    <div className="flex min-h-0 min-w-0" style={{ flex: compact ? "1 1 0%" : `${node.ratio} 1 0%`, display: compact && !panes(node.first).some(pane => pane.id === focused) ? "none" : undefined }}><LayoutView node={node.first} root={root} focused={focused} compact={compact} instance={instance} /></div>
    <div hidden={compact} style={{ display: compact ? "none" : undefined }} role="separator" aria-label="Resize Studio panes" aria-orientation={node.axis === "row" ? "vertical" : "horizontal"} aria-valuenow={Math.round(node.ratio * 100)} aria-valuemin={20} aria-valuemax={80} tabIndex={0}
      className={`relative z-10 shrink-0 touch-none bg-border transition-colors after:absolute after:content-[''] hover:bg-primary focus:bg-primary focus:outline-none ${node.axis === "row" ? "w-px cursor-col-resize after:inset-y-0 after:-inset-x-1" : "h-px cursor-row-resize after:inset-x-0 after:-inset-y-1"}`}
      onKeyDown={event => { if (["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(event.key)) { event.preventDefault(); resize(node.ratio + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -.05 : .05)); } }}
      onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={event => { if (!event.currentTarget.hasPointerCapture(event.pointerId) || !container.current) return; const rect = container.current.getBoundingClientRect(); resize(node.axis === "row" ? (event.clientX - rect.left) / rect.width : (event.clientY - rect.top) / rect.height); }} onPointerUp={event => event.currentTarget.releasePointerCapture(event.pointerId)} />
    <div className="flex min-h-0 min-w-0" style={{ flex: compact ? "1 1 0%" : `${1 - node.ratio} 1 0%`, display: compact && !panes(node.second).some(pane => pane.id === focused) ? "none" : undefined }}><LayoutView node={node.second} root={root} focused={focused} compact={compact} instance={instance} /></div>
  </div>;
}
export function StudioWorkspace() {
  const workspace = useWorkspace();
  const instance = useId();
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(max-width: 767px)");
    const change = () => setCompact(media.matches);
    change(); media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  return <div data-studio-workspace="" className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
    {/* The tab names what a view's breadcrumb would, so tab rows leave it out. */}
    <style>{'[data-studio-workspace-bar] nav[aria-label="Breadcrumb"] { display: none; }'}</style>
    {compact && panes(workspace.layout).length > 1 && <label className="flex items-center gap-2 border-b px-3 py-2 text-sm">Pane<select aria-label="Studio pane" className="min-w-0 flex-1 rounded border bg-background p-1" value={workspace.focused} onChange={event => update(current => ({ ...current, focused: event.target.value }))}>{panes(workspace.layout).map((pane, index) => <option key={pane.id} value={pane.id}>{index + 1}. {pane.tabs.find(tab => tab.href === pane.active)?.title ?? "Empty pane"}</option>)}</select></label>}
    <LayoutView node={workspace.layout} root={workspace.layout} focused={workspace.focused} compact={compact} instance={instance} />
  </div>;
}
