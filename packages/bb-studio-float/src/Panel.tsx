// The panel: a strip of tabs, and the showing tab's thread or view below.
// Drag a tab to reorder it. Drag the header anywhere on screen; dropped near
// the bottom, the panel docks again.
import { ThreadChat, ThreadTitle, useBbNavigate } from "@get-bb/plugin-sdk/app";
import {
  cn,
  CompanionView,
  companionWorkbenchAvailable,
  type CompanionPlacement,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  floatPanelFor,
  floatWindowKey,
  Icon,
  openAppPath,
  publishFloatBody,
  publishFloatLeading,
  studioTargetAt,
  threadLinkId,
  useCanFloat,
  useOpenTarget,
  type FloatTarget,
} from "@bb-studio/kit/app";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode, type RefObject } from "react";
import { update } from "./store";
import { RetainedView } from "./RetainedView";
import {
  clampFree,
  closeAll,
  closeTab,
  DOCK_EDGES,
  dropPlace,
  DOCK_SNAP,
  FREE_EDGES,
  goBack,
  navigateTab,
  HEADER_HEIGHT,
  ICON_TAB_WIDTH,
  MARGIN,
  moveTab,
  moveCompanion,
  panelSize,
  pinTab,
  placeAt,
  replaceTab,
  resizeRect,
  resizeTo,
  selectTab,
  stripLayout,
  toggleCollapsed,
  type Edge,
  type FloatState,
  type FloatTab,
  type Rect,
  type Size,
} from "./stack";

const HEADER_BUTTON =
  "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground";

/** A path tab's title when its opener gave none: the plugin's name. */
export function pathTitle(path: string): string {
  const plugin = path.split("/")[2] ?? "";
  return plugin ? plugin.charAt(0).toUpperCase() + plugin.slice(1).replace(/-/g, " ") : "Window";
}

export const tabIcon = (target: FloatTarget): string =>
  target.kind === "thread" ? "MessageSquare" : (target.icon ?? "AppWindow");

export function TabLabel({ target }: { target: FloatTarget }): ReactNode {
  if (target.title) return target.title;
  return target.kind === "thread" ? <ThreadTitle threadId={target.threadId} /> : pathTitle(target.path);
}

/** Follows an element's width. */
export function useWidth(element: HTMLElement | null): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!element) return;
    const measure = () => setWidth(element.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return width;
}

function useScreen(): Size {
  const read = () => ({ width: window.innerWidth, height: window.innerHeight });
  const [screen, setScreen] = useState(read);
  useEffect(() => {
    const onResize = () => setScreen(read());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return screen;
}

/** Publishes `element` under the tab's key for as long as it's mounted. */
function usePublished(publish: typeof publishFloatBody, tab: FloatTab, element: HTMLElement | null) {
  useEffect(() => {
    if (!element) return;
    publish({ windowKey: tab.key, target: tab.target, element, placement: tab.placement });
    // The key decides the target; a new title needn't republish.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publish, tab.key, tab.placement, element]);
  useEffect(() => () => {
    if (element) publish({ windowKey: tab.key, element: null });
  }, [publish, tab.key, element]);
}

function ThreadBody({ tab, threadId }: { tab: FloatTab; threadId: string }) {
  const [leading, setLeading] = useState<HTMLDivElement | null>(null);
  usePublished(publishFloatLeading, tab, leading);
  return (
    <ThreadChat
      threadId={threadId}
      variant="compact"
      className="min-h-0 flex-1"
      leadingContent={<div ref={setLeading} className="float-leading empty:hidden" />}
    />
  );
}

function PathBody({ tab }: { tab: FloatTab }) {
  const [body, setBody] = useState<HTMLDivElement | null>(null);
  const shown = useCanFloat(tab.target);
  usePublished(publishFloatBody, tab, body);
  if (!shown || tab.target.kind !== "path") {
    // The plugin that shows this path isn't running (yet, or any more).
    const path = tab.target.kind === "path" ? tab.target.path : "";
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
        <p>This can't show in a window right now.</p>
        <button type="button" className="rounded-md border border-border px-3 py-1.5 text-foreground hover:bg-state-hover" onClick={() => openAppPath(path, { main: true })}>
          Open it
        </button>
      </div>
    );
  }
  return <div ref={setBody} className="float-body relative min-h-0 flex-1 overflow-auto" />;
}

/**
 * The showing tab's body. A plain click on a link inside it follows the link
 * in the tab, as a browser tab would; the kit's openAppPath does the same for
 * buttons that open items. Mod- and Shift-clicks still split and float.
 */
function TabWindow({ tab }: { tab: FloatTab }) {
  const [body, setBody] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!body) return;
    // Capturing, ahead of BB's own link handling, which would open the main view.
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const element = event.target instanceof Element ? event.target : null;
      if (!element?.closest("a[href]")) return;
      const target = studioTargetAt(element);
      if (!target || (target.kind === "path" && !floatPanelFor(target.path))) return;
      event.preventDefault();
      event.stopPropagation();
      update((next) => navigateTab(next, tab.key, target));
    };
    body.addEventListener("click", onClick, true);
    return () => body.removeEventListener("click", onClick, true);
  }, [body, tab.key]);
  return (
    <div ref={setBody} data-float-window={tab.key} className="flex min-h-0 flex-1 flex-col">
      {tab.target.kind === "thread" ? <ThreadBody tab={tab} threadId={tab.target.threadId} /> : <PathBody tab={tab} />}
    </div>
  );
}

interface TabDrag {
  key: string;
  x: number;
  moved: boolean;
}

function TabStrip({ state }: { state: FloatState }) {
  const [strip, setStrip] = useState<HTMLDivElement | null>(null);
  const width = useWidth(strip);
  const drag = useRef<TabDrag | null>(null);
  // The order while a tab is being dragged, committed on drop.
  const [preview, setPreview] = useState<string[] | null>(null);
  const byKey = new Map(state.tabs.map((tab) => [tab.key, tab]));
  const order = preview ? preview.flatMap((key) => byKey.get(key) ?? []) : state.tabs;
  const activeIndex = order.findIndex((tab) => tab.key === state.active);
  const layout = stripLayout(order.length, activeIndex, width);
  const shown = order.slice(layout.start, layout.end);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>, key: string) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    drag.current = { key, x: event.clientX, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || !strip) return;
    if (!current.moved && Math.abs(event.clientX - current.x) < 4) return;
    current.moved = true;
    // Drop before the first shown tab whose middle is right of the pointer.
    const others = [...strip.querySelectorAll<HTMLElement>("[data-float-tab]")].filter((element) => element.dataset.floatTab !== current.key);
    const before = others.find((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left + rect.width / 2 > event.clientX;
    });
    const keys = order.map((tab) => tab.key).filter((key) => key !== current.key);
    const last = others.at(-1)?.dataset.floatTab;
    const index = before ? keys.indexOf(before.dataset.floatTab!) : last ? keys.indexOf(last) + 1 : keys.length;
    keys.splice(index, 0, current.key);
    setPreview(keys);
  };
  const onPointerUp = () => {
    const current = drag.current;
    drag.current = null;
    if (!current) return;
    const final = preview;
    setPreview(null);
    if (!current.moved) update((next) => selectTab(next, current.key));
    else if (final) update((next) => moveTab(next, current.key, final.indexOf(current.key)));
  };

  return (
    <div ref={setStrip} role="tablist" aria-label="Floating tabs" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
      {shown.map((tab) => {
        const active = tab.key === state.active;
        const labeled = layout.labeled || active;
        const dragging = preview !== null && drag.current?.key === tab.key;
        return (
          <div
            key={tab.key}
            role="tab"
            tabIndex={0}
            aria-selected={active}
            data-float-tab={tab.key}
            title={tab.target.title}
            className={cn(
              "float-tab group flex h-8 min-w-0 cursor-default items-center gap-1.5 rounded-md px-2 text-sm select-none",
              active ? "bg-state-active font-medium text-foreground" : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
              dragging && "opacity-60",
            )}
            style={labeled ? { flex: "0 1 180px", minWidth: 72 } : { width: ICON_TAB_WIDTH, flex: "none", justifyContent: "center", padding: 0 }}
            onPointerDown={(event) => onPointerDown(event, tab.key)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              drag.current = null;
              setPreview(null);
            }}
            onAuxClick={(event) => {
              if (event.button === 1) update((next) => closeTab(next, tab.key));
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                update((next) => selectTab(next, tab.key));
              }
            }}
          >
            <Icon name={tabIcon(tab.target)} className="size-4 shrink-0" />
            {tab.pinned && labeled ? <Icon name="Pin" className="size-3 shrink-0" aria-hidden /> : null}
            {labeled ? (
              <>
                <span className="float-tab-title min-w-0 flex-1 truncate">
                  <TabLabel target={tab.target} />
                </span>
                <span
                  role="button"
                  aria-label="Close tab"
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded hover:bg-state-hover",
                    active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                  )}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    update((next) => closeTab(next, tab.key));
                  }}
                >
                  <Icon name="X" className="size-3" />
                </span>
              </>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** What the main view shows, if a tab could show it too. */
function mainTarget(): FloatTarget | null {
  const path = `${window.location.pathname}${window.location.search}`;
  const threadId = threadLinkId(path);
  if (threadId) return { kind: "thread", threadId };
  return floatPanelFor(window.location.pathname) ? { kind: "path", path } : null;
}

function TabMenu({ state, active }: { state: FloatState; active: FloatTab }) {
  const { open, anchor } = useOpenTarget();
  const navigate = useBbNavigate();
  const move = (place: "main" | "split") => {
    if (place === "main" && companionWorkbenchAvailable()) {
      update((next) => moveCompanion(next, active.key, "main"));
      navigate.toPluginPanel("companions", { subPath: active.key });
      return;
    }
    // BB's own view takes over; the tab would only repeat it.
    update((next) => closeTab(next, active.key));
    open(active.target, place);
  };
  const main = mainTarget();
  const swap = () => {
    if (!main) return;
    update((next) => replaceTab(next, active.key, main));
    open(active.target, "main");
  };
  return (
    <>
      {anchor}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="Floating tab actions" className={HEADER_BUTTON}>
            <Icon name="MoreHorizontal" className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {companionWorkbenchAvailable() ? <DropdownMenuItem onSelect={() => update((next) => moveCompanion(next, active.key, "workbench"))}>
            <Icon name="PanelRight" className="size-4" /> Move to workbench
          </DropdownMenuItem> : null}
          <DropdownMenuItem onSelect={() => update((next) => pinTab(next, active.key, !active.pinned))}>
            <Icon name={active.pinned ? "PinOff" : "Pin"} className="size-4" />
            {active.pinned ? "Unpin tab" : "Pin tab"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => move("main")}>
            <Icon name="Maximize2" className="size-4" /> Move to main view
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => move("split")}>
            <Icon name="Columns2" className="size-4" /> Move to split
          </DropdownMenuItem>
          {main && floatWindowKey(main) !== active.key ? (
            <DropdownMenuItem onSelect={swap}>
              <Icon name="Repeat" className="size-4" /> Swap with main view
            </DropdownMenuItem>
          ) : null}
          {state.place.kind === "free" ? (
            <DropdownMenuItem onSelect={() => update((next) => placeAt(next, { kind: "dock" }))}>
              <Icon name="PanelBottom" fallback="ArrowDown" className="size-4" /> Dock at the bottom
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          {state.tabs.map((tab) => (
            <DropdownMenuItem key={tab.key} onSelect={() => update((next) => selectTab(next, tab.key))}>
              <Icon name={tabIcon(tab.target)} className="size-4" />
              <span className={cn("min-w-0 flex-1 truncate", tab.key === active.key && "font-medium")}>
                <TabLabel target={tab.target} />
              </span>
              {tab.pinned ? <Icon name="Pin" className="size-3 shrink-0" aria-hidden /> : null}
              {tab.key === active.key ? <Icon name="Check" className="size-4" /> : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => update((next) => closeTab(next, active.key))}>
            <Icon name="X" className="size-4" /> Close tab
          </DropdownMenuItem>
          {state.tabs.length > 1 ? (
            <DropdownMenuItem onSelect={() => update(closeAll)}>
              <Icon name="X" className="size-4" /> Close all
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

/**
 * Whether a header event started on the header itself. React bubbles events
 * from portals (the tab menu) through the header too; grabbing those would
 * capture the pointer and the menu item would never get its click.
 */
function fromHeader(event: { currentTarget: Element; target: EventTarget }): boolean {
  const target = event.target as Element;
  return event.currentTarget.contains(target) && !target.closest("button, [role=tab], [role=button]");
}

interface PanelDrag {
  x: number;
  y: number;
  left: number;
  bottom: number;
  size: Size;
  moved: boolean;
}

// Each edge's grab strip, inside the panel's border, and its cursor.
const EDGE_HANDLE: Record<Edge, string> = {
  n: "inset-x-3 top-0 h-1.5 cursor-ns-resize",
  s: "inset-x-3 bottom-0 h-1.5 cursor-ns-resize",
  e: "inset-y-3 right-0 w-1.5 cursor-ew-resize",
  w: "inset-y-3 left-0 w-1.5 cursor-ew-resize",
  ne: "top-0 right-0 size-3 cursor-nesw-resize",
  sw: "bottom-0 left-0 size-3 cursor-nesw-resize",
  nw: "top-0 left-0 size-3 cursor-nwse-resize",
  se: "right-0 bottom-0 size-3 cursor-nwse-resize",
};

interface PanelResize {
  edge: Edge;
  x: number;
  y: number;
  rect: Rect;
}

/**
 * Drag an edge or corner to resize the panel: docked, its top and left;
 * free, any side. Double-click one to go back to the default size.
 */
function ResizeHandles({ docked, panel, screen, onResize }: {
  docked: boolean;
  panel: RefObject<HTMLElement | null>;
  screen: Size;
  onResize(rect: Rect | null): void;
}) {
  const resize = useRef<PanelResize | null>(null);
  const rectAt = (event: PointerEvent<HTMLElement>) => {
    const start = resize.current!;
    return resizeRect(start.rect, start.edge, event.clientX - start.x, event.clientY - start.y, screen);
  };
  return (
    <>
      {(docked ? DOCK_EDGES : FREE_EDGES).map((edge) => (
        <div
          key={edge}
          aria-hidden
          data-float-resize={edge}
          className={cn("absolute z-10 touch-none", EDGE_HANDLE[edge])}
          onPointerDown={(event) => {
            if (event.button !== 0 || !panel.current) return;
            event.preventDefault();
            const { left, top, width, height } = panel.current.getBoundingClientRect();
            resize.current = { edge, x: event.clientX, y: event.clientY, rect: { left, top, width, height } };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (resize.current) onResize(rectAt(event));
          }}
          onPointerUp={(event) => {
            if (!resize.current) return;
            const rect = rectAt(event);
            resize.current = null;
            onResize(null);
            const size = { width: rect.width, height: rect.height };
            update((next) =>
              resizeTo(next, size, docked ? next.place : { kind: "free", left: rect.left, bottom: screen.height - rect.top - rect.height }),
            );
          }}
          onPointerCancel={() => {
            resize.current = null;
            onResize(null);
          }}
          onDoubleClick={() => update((next) => resizeTo(next, null))}
        />
      ))}
    </>
  );
}

/** The panel. `dockOffset` keeps a docked panel left of the corner content beside it. */
export function Stack({ state, dockOffset }: { state: FloatState; dockOffset: number }) {
  const navigate = useBbNavigate();
  const native = companionWorkbenchAvailable();
  const floatingTabs = native ? state.tabs.filter((tab) => !tab.placement || tab.placement === "floating") : state.tabs;
  const floatingActive = floatingTabs.find((tab) => tab.key === state.active) ?? floatingTabs.at(-1);
  const floatingState = { ...state, tabs: floatingTabs, active: floatingActive?.key ?? null };
  const screen = useScreen();
  const panel = useRef<HTMLElement>(null);
  const drag = useRef<PanelDrag | null>(null);
  const [dragAt, setDragAt] = useState<{ left: number; bottom: number; snap: boolean } | null>(null);
  // The panel's rect while an edge is being dragged, committed on release.
  const [resizing, setResizing] = useState<Rect | null>(null);
  const active = floatingActive ?? state.tabs.at(-1);
  if (!active) return null;
  const floatHidden = state.hidden || floatingTabs.length === 0;
  const move = (key: string, placement: CompanionPlacement) => {
    update((next) => moveCompanion(next, key, placement));
    if (placement === "main") navigate.toPluginPanel("companions", { subPath: key });
  };

  const size = panelSize(state.size, screen);
  const width = resizing?.width ?? size.width;
  const height = state.collapsed ? HEADER_HEIGHT : (resizing?.height ?? size.height);
  const dockRight = `clamp(${MARGIN}px, calc(var(--studio-float-right, 1.5rem) + ${dockOffset}px), ${Math.max(MARGIN, screen.width - width - MARGIN)}px)`;
  const resized = resizing && state.place.kind === "free" ? { left: resizing.left, bottom: screen.height - resizing.top - resizing.height } : null;
  const free =
    dragAt ?? resized ?? (state.place.kind === "free" ? clampFree(state.place.left, state.place.bottom, { width, height }, screen) : null);
  const position: CSSProperties = free ? { left: free.left, bottom: free.bottom } : { right: dockRight, bottom: 0 };

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !panel.current) return;
    if (!fromHeader(event)) return;
    const rect = panel.current.getBoundingClientRect();
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      left: rect.left,
      bottom: window.innerHeight - rect.bottom,
      size: { width: rect.width, height: rect.height },
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const dropAt = (event: PointerEvent<HTMLElement>, start: PanelDrag) => ({
    left: start.left + event.clientX - start.x,
    bottom: start.bottom - (event.clientY - start.y),
  });
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const start = drag.current;
    if (!start) return;
    if (!start.moved && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 4) return;
    start.moved = true;
    const raw = dropAt(event, start);
    setDragAt({ ...clampFree(raw.left, raw.bottom, start.size, screen), snap: raw.bottom < DOCK_SNAP });
  };
  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    const start = drag.current;
    drag.current = null;
    if (!start?.moved) return;
    const raw = dropAt(event, start);
    setDragAt(null);
    update((next) => placeAt(next, dropPlace(raw.left, raw.bottom, { width, height: start.size.height }, screen)));
  };

  return (
    <>
      {dragAt?.snap ? (
        // Where the panel docks if dropped now.
        <div
          aria-hidden
          className="pointer-events-none fixed z-40 rounded-t-lg border-2 border-b-0 border-dashed border-primary/60 bg-primary/5"
          style={{ right: dockRight, bottom: 0, width, height }}
        />
      ) : null}
      <section
        ref={panel}
        hidden={floatHidden}
        aria-label="Floating tabs"
        data-float-place={dragAt ? "dragging" : resizing ? "resizing" : state.place.kind}
        className={cn(
          // BB's page header is a window drag region in the desktop app, and the
          // OS swallows clicks there. The panel opts out, as BB's own popups do.
          "[app-region:no-drag] [-webkit-app-region:no-drag]",
          "bb-float-stack pointer-events-auto fixed z-40 flex flex-col overflow-hidden border border-border bg-background shadow-xl",
          free ? "rounded-lg" : "rounded-t-lg border-b-0",
          dragAt && "shadow-2xl",
          resizing && "select-none",
        )}
        style={{ ...position, width, height, ...(floatHidden ? { display: "none" } : {}) }}
      >
        {state.collapsed || dragAt ? null : (
          <ResizeHandles docked={state.place.kind === "dock"} panel={panel} screen={screen} onResize={setResizing} />
        )}
        <header
          className={cn("flex shrink-0 items-center gap-1 border-border pr-1 pl-1", !state.collapsed && "border-b", dragAt ? "cursor-grabbing" : "cursor-grab")}
          style={{ height: HEADER_HEIGHT }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            drag.current = null;
            setDragAt(null);
          }}
          onDoubleClick={(event) => {
            if (fromHeader(event)) update(toggleCollapsed);
          }}
        >
          <Icon name="DragDropVertical" className="size-4 shrink-0 text-muted-foreground/60" aria-hidden />
          {active.back?.length && !state.collapsed ? (
            <button type="button" aria-label="Back" title="Back" className={HEADER_BUTTON} onClick={() => update((next) => goBack(next, active.key))}>
              <Icon name="ChevronLeft" className="size-4" />
            </button>
          ) : null}
          <TabStrip state={floatingState} />
          <button
            type="button"
            aria-label={state.collapsed ? "Open floating tabs" : "Fold floating tabs"}
            className={HEADER_BUTTON}
            onClick={() => update(toggleCollapsed)}
          >
            <Icon name={state.collapsed ? "ChevronUp" : "Minus"} className="size-4" />
          </button>
          <TabMenu state={floatingState} active={active} />
        </header>
        {state.tabs.map((tab) => (
          <RetainedView key={tab.key} visible={(native && tab.placement !== undefined && tab.placement !== "floating") || (tab.key === floatingActive?.key && !state.collapsed && !floatHidden)}>
            <CompanionView id={tab.key} title={tab.target.title ?? (tab.target.kind === "thread" ? "Conversation" : pathTitle(tab.target.path))}
              icon={tabIcon(tab.target)} placement={tab.placement ?? "floating"} activation={tab.key === state.active ? (tab.activation ?? 0) : 0} pinned={tab.pinned}
              onPinnedChange={(pinned) => update((next) => pinTab(next, tab.key, pinned))} onSelect={() => update((next) => selectTab(next, tab.key))}
              onClose={() => update((next) => closeTab(next, tab.key))} onPlacementChange={(placement) => move(tab.key, placement)}
              onBack={tab.back?.length ? () => update((next) => goBack(next, tab.key)) : undefined}>
              {tab.opened ? <TabWindow tab={native ? tab : { ...tab, placement: "floating" }} /> : null}
            </CompanionView>
          </RetainedView>
        ))}
      </section>
    </>
  );
}
