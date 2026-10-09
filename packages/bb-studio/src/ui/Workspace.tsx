import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type DragEvent } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { Icon, registerWorkspaceCloser, setWorkspaceActive, canOpenWorkspaceItem, openAppPath, publishWorkspaceAnchor, registerWorkspaceOpener, studioPath, studioTargetAt, subscribeWorkspace, workspaceRevision, WORKSPACE_DRAG, WORKSPACE_PATH, type WorkspaceItem, type WorkspacePlacement } from "@bb-studio/kit/app";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@bb-studio/kit/ui";
import type { rpcContract } from "../contract";
import { closeTab, emptyWorkspace, mapLayout, openItem, panes, parseWorkspace, type Layout, type Pane, type Tab, type Workspace } from "./workspace-state";

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
export function closeWorkspaceTabs(hrefs: readonly string[]) {
  update(current => hrefs.reduce((next, href) => closeTab(next, href), current));
}
const BUTTON = "inline-flex size-8 shrink-0 items-center justify-center rounded hover:bg-state-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";

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
      update(current => ({ ...current, layout: mapLayout(current.layout, node => node.kind === "pane" ? { ...node, tabs: node.tabs.map(each => each.href === item.href ? { ...each, title: tab.title } : each) } : node) }));
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
    return () => document.removeEventListener("dragstart", drag);
  }, []);
  return null;
}

function dragged(event: DragEvent): WorkspaceItem | null {
  try {
    const value = JSON.parse(event.dataTransfer.getData(WORKSPACE_DRAG));
    return typeof value?.href === "string" && canOpenWorkspaceItem(value.href) ? { href: value.href, ...(typeof value.title === "string" ? { title: value.title } : {}) } : null;
  } catch { return null; }
}
function accepts(event: DragEvent) { return event.dataTransfer.types.includes(WORKSPACE_DRAG); }
function move(item: WorkspaceItem, pane: string, placement: WorkspacePlacement, before?: string) {
  update(current => openItem(current, item, placement, pane, before));
}
function select(pane: string, href: string) {
  update(current => ({ focused: pane, layout: mapLayout(current.layout, node => node.kind === "pane" && node.id === pane ? { ...node, active: href } : node) }));
}
function EditorSlot({ tab }: { tab: Tab }) {
  const element = useRef<HTMLDivElement>(null);
  useSyncExternalStore(subscribeWorkspace, workspaceRevision, () => 0);
  const available = canOpenWorkspaceItem(tab.href);
  useLayoutEffect(() => {
    if (!element.current) return;
    return publishWorkspaceAnchor({ id: `workspace:${tab.href}`, path: tab.href, element: element.current });
  }, [tab.href]);
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col">
    {!available && <div className="p-6 text-sm text-muted-foreground">This item's plugin is unavailable. Enable it to reopen this tab. <button className="underline" onClick={() => openAppPath(tab.href, { standalone: true })}>Open item page</button></div>}
    <div ref={element} data-studio-workspace-editor={tab.href} className="flex min-h-0 min-w-0 flex-1 flex-col" />
  </div>;
}
function TabPane({ pane, focused }: { pane: Pane; focused: string }) {
  const [drop, setDrop] = useState<WorkspacePlacement | null>(null);
  const active = pane.tabs.find(tab => tab.href === pane.active);
  const place = (event: DragEvent): WorkspacePlacement => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width, y = (event.clientY - rect.top) / rect.height;
    return x < .22 ? "left" : x > .78 ? "right" : y < .22 ? "top" : y > .78 ? "bottom" : "tab";
  };
  return <section aria-label="Studio pane" data-workspace-pane={pane.id} className="relative flex h-full min-h-0 min-w-[240px] flex-1 flex-col overflow-hidden" onPointerDownCapture={() => { if (focused !== pane.id) update(current => ({ ...current, focused: pane.id })); }}>
    <div className={`flex min-h-9 shrink-0 items-center border-b ${focused === pane.id ? "bg-state-hover" : "bg-background"}`}
      onDragOver={event => { if (accepts(event)) { event.preventDefault(); event.stopPropagation(); } }}
      onDrop={event => { const item = dragged(event); if (item) { event.preventDefault(); event.stopPropagation(); move(item, pane.id, "tab"); } }}>
      <div role="tablist" aria-label="Studio items" className="flex min-w-0 flex-1 overflow-x-auto">
        {pane.tabs.map((tab, index) => <div key={tab.href} className="flex shrink-0 items-center border-r" data-studio-workspace-tab={tab.href} draggable onDragStart={event => { event.dataTransfer.setData(WORKSPACE_DRAG, JSON.stringify(tab)); event.dataTransfer.effectAllowed = "move"; }}
          onDragOver={event => { if (accepts(event)) event.preventDefault(); }}
          onDrop={event => { const item = dragged(event); if (item) { event.preventDefault(); event.stopPropagation(); move(item, pane.id, "tab", tab.href); } }}>
          <button role="tab" aria-selected={pane.active === tab.href} aria-controls={`view-${pane.id}-${index}`} id={`tab-${pane.id}-${index}`} tabIndex={pane.active === tab.href ? 0 : -1}
            className={`h-9 max-w-52 truncate px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${pane.active === tab.href ? "bg-background text-foreground" : "text-muted-foreground hover:bg-state-hover"}`}
            onClick={() => select(pane.id, tab.href)} onKeyDown={event => {
              const next = event.key === "ArrowRight" ? (index + 1) % pane.tabs.length : event.key === "ArrowLeft" ? (index + pane.tabs.length - 1) % pane.tabs.length : event.key === "Home" ? 0 : event.key === "End" ? pane.tabs.length - 1 : null;
              if (next !== null) { event.preventDefault(); select(pane.id, pane.tabs[next]!.href); document.getElementById(`tab-${pane.id}-${next}`)?.focus(); }
              if (event.key === "Delete") { event.preventDefault(); update(current => closeTab(current, tab.href)); }
            }}>{tab.title}</button>
          <button className={BUTTON} aria-label={`Close ${tab.title}`} onClick={() => update(current => closeTab(current, tab.href))}><Icon name="X" className="size-3.5" /></button>
        </div>)}
      </div>
      <button className={BUTTON} aria-label="Browse Studio items" title="Browse Studio items" onClick={() => openAppPath(studioPath("collection"))}><Icon name="Plus" className="size-4" /></button>
      {active && <DropdownMenu><DropdownMenuTrigger asChild><button className={BUTTON} aria-label="Arrange active tab"><Icon name="MoreHorizontal" className="size-4" /></button></DropdownMenuTrigger><DropdownMenuContent align="end">
        {(["left", "right", "top", "bottom"] as const).map(edge => <DropdownMenuItem key={edge} disabled={pane.tabs.length < 2 || panes(snapshot().layout).length >= 8} onSelect={() => move(active, pane.id, edge)}>Split {edge}</DropdownMenuItem>)}
        {panes(snapshot().layout).filter(other => other.id !== pane.id).map((other, index) => <DropdownMenuItem key={other.id} onSelect={() => move(active, other.id, "tab")}>Move to pane {index + 1}</DropdownMenuItem>)}
        <DropdownMenuItem onSelect={() => update(current => closeTab(current, active.href))}>Close tab</DropdownMenuItem>
      </DropdownMenuContent></DropdownMenu>}
    </div>
    <div className="relative flex min-h-0 flex-1 flex-col" onDragOver={event => { if (accepts(event)) { event.preventDefault(); setDrop(place(event)); } }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(null); }} onDrop={event => { setDrop(null); const item = dragged(event); if (item) { event.preventDefault(); event.stopPropagation(); move(item, pane.id, place(event)); } }}>
      {pane.tabs.map((tab, index) => <div key={tab.href} role="tabpanel" id={`view-${pane.id}-${index}`} aria-labelledby={`tab-${pane.id}-${index}`} hidden={pane.active !== tab.href} style={{ display: pane.active === tab.href ? "flex" : "none" }} className="min-h-0 min-w-0 flex-1 flex-col"><EditorSlot tab={tab} /></div>)}
      {!pane.tabs.length && <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-sm text-muted-foreground"><p>Open an item from the sidebar, or drop one here.</p><button className="rounded border px-3 py-2 text-foreground hover:bg-state-hover" onClick={() => openAppPath(studioPath("collection"))}>Browse Studio</button></div>}
      {drop && <div className="pointer-events-none absolute z-20 flex items-center justify-center border-2 border-primary bg-primary/10 text-sm font-medium" style={{ inset: 0, ...(drop === "left" ? { right: "50%" } : drop === "right" ? { left: "50%" } : drop === "top" ? { bottom: "50%" } : drop === "bottom" ? { top: "50%" } : {}) }}>{drop === "tab" ? "Open as tab" : `Split ${drop}`}</div>}
    </div>
  </section>;
}
function LayoutView({ node, focused }: { node: Layout; focused: string }) {
  const container = useRef<HTMLDivElement>(null);
  if (node.kind === "pane") return <TabPane pane={node} focused={focused} />;
  const resize = (ratio: number) => update(current => ({ ...current, layout: mapLayout(current.layout, each => each.id === node.id && each.kind === "split" ? { ...each, ratio: Math.max(.2, Math.min(.8, ratio)) } : each) }));
  return <div ref={container} className="flex h-full min-h-0 min-w-0 flex-1" style={{ flexDirection: node.axis }}>
    <div className="flex min-h-0 min-w-0" style={{ flex: `${node.ratio} 1 0%` }}><LayoutView node={node.first} focused={focused} /></div>
    <div role="separator" aria-label="Resize Studio panes" aria-orientation={node.axis === "row" ? "vertical" : "horizontal"} aria-valuenow={Math.round(node.ratio * 100)} aria-valuemin={20} aria-valuemax={80} tabIndex={0}
      className={`shrink-0 touch-none bg-border hover:bg-primary focus:bg-primary ${node.axis === "row" ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize"}`}
      onKeyDown={event => { if (["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(event.key)) { event.preventDefault(); resize(node.ratio + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -.05 : .05)); } }}
      onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={event => { if (!event.currentTarget.hasPointerCapture(event.pointerId) || !container.current) return; const rect = container.current.getBoundingClientRect(); resize(node.axis === "row" ? (event.clientX - rect.left) / rect.width : (event.clientY - rect.top) / rect.height); }} onPointerUp={event => event.currentTarget.releasePointerCapture(event.pointerId)} />
    <div className="flex min-h-0 min-w-0" style={{ flex: `${1 - node.ratio} 1 0%` }}><LayoutView node={node.second} focused={focused} /></div>
  </div>;
}
export function StudioWorkspace() {
  const workspace = useWorkspace();
  return <div data-studio-workspace="" className="flex h-full min-h-0 min-w-0 flex-1 overflow-auto"><LayoutView node={workspace.layout} focused={workspace.focused} /></div>;
}
