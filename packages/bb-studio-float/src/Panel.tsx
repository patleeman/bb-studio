// The panel: a strip of tabs, and the showing tab's thread or view below.
// Drag a tab to reorder it. Drag the header anywhere on screen; dropped near
// the bottom, the panel docks again.
import { experimental_useSidebarThreadActions, ThreadChat, ThreadTitle } from "@get-bb/plugin-sdk/app";
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Icon,
  openAppPath,
  publishFloatBody,
  publishFloatLeading,
  useCanFloat,
  type FloatTarget,
} from "@bb-studio/kit/app";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { update } from "./store";
import {
  clampFree,
  closeAll,
  closeTab,
  dropPlace,
  DOCK_SNAP,
  HEADER_HEIGHT,
  ICON_TAB_WIDTH,
  MARGIN,
  moveTab,
  PANEL_WIDTH,
  placeAt,
  selectTab,
  stripLayout,
  toggleCollapsed,
  type FloatState,
  type FloatTab,
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
    publish({ windowKey: tab.key, target: tab.target, element });
    return () => publish({ windowKey: tab.key, element: null });
    // The key decides the target; a new title needn't republish.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        <button type="button" className="rounded-md border border-border px-3 py-1.5 text-foreground hover:bg-state-hover" onClick={() => openAppPath(path)}>
          Open it
        </button>
      </div>
    );
  }
  return <div ref={setBody} className="float-body relative min-h-0 flex-1 overflow-auto" />;
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

function TabMenu({ state, active }: { state: FloatState; active: FloatTab }) {
  const actions = experimental_useSidebarThreadActions();
  const openFull = (split: boolean) => {
    // BB's own view takes over; the tab would only repeat it.
    update((next) => closeTab(next, active.key));
    if (active.target.kind === "thread") actions.open(active.target.threadId, { split });
    else openAppPath(active.target.path);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Floating tab actions" className={HEADER_BUTTON}>
          <Icon name="MoreHorizontal" className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem onSelect={() => openFull(false)}>
          <Icon name="Maximize2" className="size-4" /> Open full
        </DropdownMenuItem>
        {active.target.kind === "thread" ? (
          <DropdownMenuItem onSelect={() => openFull(true)}>
            <Icon name="Columns2" className="size-4" /> Open in split
          </DropdownMenuItem>
        ) : null}
        {state.place.kind === "free" ? (
          <DropdownMenuItem onSelect={() => update((next) => placeAt(next, { kind: "dock" }))}>
            <Icon name="PanelBottom" fallback="ArrowDownToLine" className="size-4" /> Dock at the bottom
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        {state.tabs.map((tab) => (
          <DropdownMenuItem key={tab.key} onSelect={() => update((next) => selectTab(next, tab.key))}>
            <Icon name={tabIcon(tab.target)} className="size-4" />
            <span className={cn("min-w-0 flex-1 truncate", tab.key === active.key && "font-medium")}>
              <TabLabel target={tab.target} />
            </span>
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
  );
}

interface PanelDrag {
  x: number;
  y: number;
  left: number;
  bottom: number;
  size: Size;
  moved: boolean;
}

/** The panel. `dockOffset` keeps a docked panel left of the corner content beside it. */
export function Stack({ state, dockOffset }: { state: FloatState; dockOffset: number }) {
  const screen = useScreen();
  const panel = useRef<HTMLElement>(null);
  const drag = useRef<PanelDrag | null>(null);
  const [dragAt, setDragAt] = useState<{ left: number; bottom: number; snap: boolean } | null>(null);
  const active = state.tabs.find((tab) => tab.key === state.active) ?? state.tabs.at(-1);
  if (!active) return null;

  const width = Math.min(PANEL_WIDTH, screen.width - MARGIN * 2);
  const height = state.collapsed ? HEADER_HEIGHT : Math.min(560, screen.height - 96);
  const dockRight = `calc(var(--studio-float-right, 1.5rem) + ${dockOffset}px)`;
  const free = dragAt ?? (state.place.kind === "free" ? clampFree(state.place.left, state.place.bottom, { width, height }, screen) : null);
  const position: CSSProperties = free ? { left: free.left, bottom: free.bottom } : { right: dockRight, bottom: 0 };

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !panel.current) return;
    if ((event.target as Element).closest("button, [role=tab], [role=button]")) return;
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
        aria-label="Floating tabs"
        data-float-place={dragAt ? "dragging" : state.place.kind}
        className={cn(
          "bb-float-stack pointer-events-auto fixed z-40 flex flex-col overflow-hidden border border-border bg-background shadow-xl",
          free ? "rounded-lg" : "rounded-t-lg border-b-0",
          dragAt && "shadow-2xl",
        )}
        style={{ ...position, width, height }}
      >
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
            if (!(event.target as Element).closest("button, [role=tab], [role=button]")) update(toggleCollapsed);
          }}
        >
          <Icon name="GripVertical" fallback="MoreVertical" className="size-4 shrink-0 text-muted-foreground/60" aria-hidden />
          <TabStrip state={state} />
          <button
            type="button"
            aria-label={state.collapsed ? "Open floating tabs" : "Fold floating tabs"}
            className={HEADER_BUTTON}
            onClick={() => update(toggleCollapsed)}
          >
            <Icon name={state.collapsed ? "ChevronUp" : "Minus"} className="size-4" />
          </button>
          <TabMenu state={state} active={active} />
        </header>
        {state.collapsed ? null : (
          <div key={active.key} data-float-window={active.key} className="flex min-h-0 flex-1 flex-col">
            {active.target.kind === "thread" ? <ThreadBody tab={active} threadId={active.target.threadId} /> : <PathBody tab={active} />}
          </div>
        )}
      </section>
    </>
  );
}
