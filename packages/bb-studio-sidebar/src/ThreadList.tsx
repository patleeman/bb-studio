// The sidebar's thread list, organized by Studio Space: one Space at a time
// (or All stacked), switched with dots at the bottom, ⌃⌥←/→ or a swipe.
import { SidebarAnchors } from "@bb-studio/kit/app";
import { cn, Icon, Tooltip } from "@bb-studio/kit/ui";
import {
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreads,
  type PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  ALL_SPACES,
  buildSpaceGroups,
  createSpaceResolver,
  hiddenThreadIds,
  neighbourSpaceId,
  resolveCurrentSpace,
  spacesNeedingYou,
  threadLineIds,
  type SpaceGroup,
  type StudioSpace,
  type Thread,
  type ThreadNode,
} from "./model.js";
import { NEW_SPACE_EVENT, SpaceActionsMenu, SpaceBrowseMenu, SpaceNewMenu } from "./SpaceMenus.js";
import { handOffNewThreadSpace, publishSpaceOrganization, usePreferences, useStudio, useThreadLines, type StudioState } from "./studio.js";
import { HomeMark, RowProvider, THREAD_DRAG_TYPE, ThreadTree, type RowContextValue, type RowMark } from "./ThreadRow.js";

/** Whether `target` takes typed text. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.closest("[contenteditable]:not([contenteditable=false])")) return true;
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

/** ⌃⌥← / ⌃⌥→ outside text fields, and a horizontal two-finger swipe over `area`, step through the Spaces. */
export function useSpaceSwitchGestures(area: RefObject<HTMLElement | null>, step: (direction: -1 | 1) => void): void {
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !event.ctrlKey || !event.altKey || event.metaKey || event.shiftKey) return;
      if (event.isComposing || isTextEntryTarget(event.target)) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      stepRef.current(event.key === "ArrowLeft" ? -1 : 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    const element = area.current;
    if (!element) return;
    let travel = 0;
    let spent = false;
    let idle: ReturnType<typeof setTimeout> | null = null;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) <= Math.abs(event.deltaY) * 2) return;
      // One switch per gesture; the gesture (and its momentum) ends after a quiet spell.
      if (idle) clearTimeout(idle);
      idle = setTimeout(() => { travel = 0; spent = false; }, 250);
      if (spent) return;
      travel += event.deltaX;
      if (Math.abs(travel) < 120) return;
      spent = true;
      stepRef.current(travel > 0 ? 1 : -1);
    };
    element.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      element.removeEventListener("wheel", onWheel);
      if (idle) clearTimeout(idle);
    };
  }, [area]);
}

/** Lets `element` fill the rest of the sidebar's scroll area, so the switcher sits at the bottom. */
function useFillSidebar(element: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const target = element.current;
    const content = target?.closest<HTMLElement>('[data-sidebar="content"]');
    if (!target || !content || typeof ResizeObserver === "undefined") return;
    const fit = () => {
      const offset = target.getBoundingClientRect().top - content.getBoundingClientRect().top + content.scrollTop;
      const room = content.clientHeight - offset - (Number.parseFloat(getComputedStyle(content).paddingBottom) || 0);
      target.style.minHeight = `${Math.max(0, Math.floor(room))}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(content);
    return () => {
      observer.disconnect();
      target.style.minHeight = "";
    };
  }, [element]);
}

/** Takes a thread dragged from a row and moves it into `space`. */
function useSpaceDrop(space: StudioSpace, move: (ids: string[], space: StudioSpace) => unknown) {
  const [over, setOver] = useState(false);
  return {
    over,
    props: {
      onDragOver: (event: React.DragEvent) => {
        if (!event.dataTransfer.types.includes(THREAD_DRAG_TYPE)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (event: React.DragEvent) => {
        setOver(false);
        const id = event.dataTransfer.getData(THREAD_DRAG_TYPE);
        if (!id) return;
        event.preventDefault();
        void move([id], space);
      },
    },
  };
}

/** A Space's emoji or colour dot, or the default Space's house. */
function SpaceMark({ space, size = "sm" }: { space: StudioSpace; size?: "sm" | "md" }) {
  if (space.isDefault) return <HomeMark className={size === "md" ? "size-3.5" : "size-3"} />;
  return (
    <span data-sidebar-space-mark="" aria-hidden="true" className="inline-flex size-4 shrink-0 items-center justify-center">
      {space.icon
        ? <span className={cn("leading-none", size === "md" ? "text-[15px]" : "text-[13px]")}>{space.icon}</span>
        : <span className={cn("rounded-full", size === "md" ? "size-2.5" : "size-2")} style={{ background: space.color }} />}
    </span>
  );
}

/** One dot in the switcher; a thread dropped on it moves into the Space. */
function SpaceDot({ space, current, needsYou, onSelect, move }: {
  space: StudioSpace;
  current: boolean;
  needsYou: boolean;
  onSelect(spaceId: string): void;
  move: (ids: string[], space: StudioSpace) => unknown;
}) {
  const drop = useSpaceDrop(space, move);
  const name = space.isDefault ? "Home" : space.name;
  return (
    <Tooltip label={drop.over ? `Move to ${name}` : name} side="top">
      <button
        type="button"
        aria-label={needsYou ? `${name}, needs you` : name}
        aria-current={current ? "true" : undefined}
        data-space-id={space.id}
        onClick={() => onSelect(space.id)}
        {...drop.props}
        className={cn(
          "relative inline-flex size-7 items-center justify-center rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-ring",
          drop.over ? "bg-sidebar-accent ring-2 ring-sidebar-ring" : current ? "bg-sidebar-accent" : "opacity-60 hover:bg-sidebar-accent/60 hover:opacity-100",
        )}
      >
        <SpaceMark space={space} size="md" />
        {needsYou ? <span data-space-needs-you="" aria-hidden="true" className="absolute top-1 right-1 size-1.5 rounded-full bg-warning" /> : null}
      </button>
    </Tooltip>
  );
}

/** All, then a dot per Space in Studio's order, then + for a new Space. */
function SpaceSwitcher({ spaces, currentId, attention, onSelect, move }: {
  spaces: readonly StudioSpace[];
  currentId: string | null;
  attention: ReadonlySet<string>;
  onSelect(spaceId: string): void;
  move: (ids: string[], space: StudioSpace) => unknown;
}) {
  const plain = "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-ring";
  return (
    <nav aria-label="Spaces" data-sidebar-space-switcher="" className="sticky bottom-0 z-40 mt-auto flex flex-wrap items-center justify-center gap-0.5 bg-sidebar px-2 pt-1.5 pb-2">
      <Tooltip label="All Spaces" side="top">
        <button
          type="button"
          aria-label="All Spaces"
          aria-current={currentId === ALL_SPACES ? "true" : undefined}
          data-space-id={ALL_SPACES}
          onClick={() => onSelect(ALL_SPACES)}
          className={cn(plain, currentId === ALL_SPACES ? "bg-sidebar-accent text-sidebar-foreground" : "opacity-60 hover:bg-sidebar-accent/60 hover:opacity-100")}
        >
          <Icon name="GridView" className="size-3.5" />
        </button>
      </Tooltip>
      {spaces.map((space) => (
        <SpaceDot key={space.id} space={space} current={space.id === currentId} needsYou={attention.has(space.id)} onSelect={onSelect} move={move} />
      ))}
      <Tooltip label="New Space" side="top">
        <button
          type="button"
          aria-label="New Space"
          onClick={() => window.dispatchEvent(new CustomEvent(NEW_SPACE_EVENT, { cancelable: true }))}
          className={cn(plain, "opacity-60 hover:bg-sidebar-accent/60 hover:opacity-100")}
        >
          <Icon name="Plus" className="size-3.5" />
        </button>
      </Tooltip>
    </nav>
  );
}

/** A Space: its heading (mark, name, controls) and its threads; the heading takes dropped threads. */
function SpaceSection({ group, studio, threads, move, needsYou, collapse, hiddenCount, revealed, onToggleRevealed, onNewThread, children }: {
  group: SpaceGroup;
  studio: StudioState;
  threads: readonly Thread[];
  move: (ids: string[], space: StudioSpace) => unknown;
  needsYou: boolean;
  collapse: { collapsed: boolean; toggle(): void } | null;
  hiddenCount: number;
  revealed: boolean;
  onToggleRevealed(): void;
  onNewThread(): void;
  children: ReactNode;
}) {
  const { space } = group;
  const name = space.isDefault ? "Home" : space.name;
  const drop = useSpaceDrop(space, move);
  return (
    <section data-sidebar-section-id={`space:${space.id}`} aria-label={name} {...drop.props} className={cn("rounded-md", drop.over && "bg-sidebar-accent/40 ring-1 ring-sidebar-ring")}>
      <div data-sidebar-sticky-tier="label" className="group/space-heading sticky top-0 z-30 flex h-8 items-center gap-1.5 bg-sidebar pr-1 pl-1">
        <span className="relative mr-0.5 grid size-5 shrink-0 place-items-center rounded bg-sidebar-accent/70">
          <SpaceMark space={space} />
          {needsYou ? <span data-space-needs-you="" role="img" aria-label="Needs you" className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-warning ring-2 ring-sidebar" /> : null}
        </span>
        <button
          type="button"
          title={name}
          disabled={!collapse}
          aria-expanded={collapse ? !collapse.collapsed : undefined}
          onClick={collapse?.toggle}
          className="min-w-0 flex-1 truncate text-left text-xs font-medium text-muted-foreground enabled:hover:text-sidebar-foreground"
        >
          {name}
        </button>
        <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/space-heading:opacity-100 has-[[data-state=open]]:opacity-100 max-md:pointer-coarse:opacity-100 focus-within:opacity-100">
          <SpaceBrowseMenu space={space} spaces={studio.spaces} spaceOf={studio.spaceOf} activeThreads={threads} items={studio.items[space.id] ?? []} />
          <SpaceNewMenu space={space} onNewThread={onNewThread} />
          <SpaceActionsMenu space={space} onNewThread={onNewThread} hiddenCount={hiddenCount} revealed={revealed} onToggleRevealed={onToggleRevealed} />
        </span>
      </div>
      {collapse?.collapsed ? null : <div className="flex flex-col">{children}</div>}
    </section>
  );
}

/** "every5minutes" reads "every 5 minutes". */
function cadenceLabel(cadence: string): string {
  return cadence.replace(/^every(\d+)(\w+)$/u, "every $1 $2");
}

function flatten(nodes: readonly ThreadNode[]): Thread[] {
  return nodes.flatMap((node) => [node.thread, ...flatten(node.children)]);
}

/** Drops hidden threads from a tree list. */
function prune(nodes: readonly ThreadNode[], hidden: ReadonlySet<string>): ThreadNode[] {
  return nodes.filter((node) => !hidden.has(node.thread.id)).map((node) => ({ ...node, children: prune(node.children, hidden) }));
}

export function ThreadList({ activeThreadId, onNavigate }: PluginThreadListProps) {
  const { status, threads: allThreads } = experimental_useSidebarThreads();
  const actions = experimental_useSidebarThreadActions();
  const threads = useMemo(() => allThreads.filter((thread) => !thread.isHidden && !thread.isArchived), [allThreads]);
  const [studio, studioActions] = useStudio(threads.length);
  const [prefs, setPref] = usePreferences();
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());
  const { spaces, spaceOf, leads } = studio;

  useEffect(() => { publishSpaceOrganization(); }, []);

  const currentId = resolveCurrentSpace(spaces, prefs.currentSpace);
  const isAll = currentId === ALL_SPACES;
  const switchTo = useCallback((spaceId: string) => setPref("currentSpace", spaceId), [setPref]);
  const resolve = useMemo(() => createSpaceResolver(threads, spaceOf, spaces), [spaceOf, spaces, threads]);
  const attention = useMemo(() => spacesNeedingYou(threads, resolve), [resolve, threads]);
  const leadIds = useMemo(() => new Set(Object.values(leads).filter((id): id is string => !!id)), [leads]);
  const hidden = useMemo(
    () => hiddenThreadIds(threads, prefs.hiddenThreads, new Set([...leadIds, ...(activeThreadId ? [activeThreadId] : [])])),
    [activeThreadId, leadIds, prefs.hiddenThreads, threads],
  );
  const groups = useMemo(() => buildSpaceGroups(threads, spaces, spaceOf, leads), [leads, spaceOf, spaces, threads]);
  const shown = groups.filter((group) => isAll || group.space.id === currentId);
  // The Chief of Staff (the default Space's lead) stays on top of every other Space shown alone.
  const top = groups.find((group) => group.space.isDefault) ?? null;
  const pinnedChief = !isAll && top?.lead && !shown.includes(top) ? top.lead : null;
  const collapsedSpaces = useMemo(() => new Set(prefs.collapsedSpaces), [prefs.collapsedSpaces]);
  const toggleSpace = (spaceId: string) => setPref("collapsedSpaces", (current) => current.includes(spaceId) ? current.filter((id) => id !== spaceId) : [...current, spaceId]);

  // Opening a thread from elsewhere shows its Space; All expands it.
  const revealedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!activeThreadId || revealedFor.current === activeThreadId || studio.status !== "ready") return;
    const thread = threads.find((candidate) => candidate.id === activeThreadId);
    if (!thread) return;
    revealedFor.current = activeThreadId;
    const spaceId = resolve(thread);
    if (!spaceId || (pinnedChief && flatten([pinnedChief]).includes(thread))) return;
    if (isAll) { if (collapsedSpaces.has(spaceId)) toggleSpace(spaceId); } else if (spaceId !== currentId) switchTo(spaceId);
  });

  const area = useRef<HTMLDivElement>(null);
  useFillSidebar(area);
  useSpaceSwitchGestures(area, (step) => {
    const next = neighbourSpaceId(spaces, currentId, step);
    if (next && next !== currentId) switchTo(next);
  });

  // Latest lines for the threads on show: leads first, then by recency.
  const visible = shown.filter((group) => !isAll || !collapsedSpaces.has(group.space.id));
  const lineIds = useMemo(() => threadLineIds(
    [...(pinnedChief ? [pinnedChief.thread] : []), ...visible.flatMap((group) => group.lead ? [group.lead.thread] : [])],
    [...(pinnedChief ? flatten(pinnedChief.children) : []), ...visible.flatMap((group) => group.all)],
  ), [pinnedChief, visible]);
  const statusKey = threads.filter((thread) => lineIds.includes(thread.id))
    .map((thread) => `${thread.id}:${thread.status}:${thread.runtimeStatus}:${thread.indicator}:${thread.hasPendingInteraction}:${thread.isUnread}`).join("|");
  const lines = useThreadLines(lineIds, statusKey);

  const marks = useMemo(() => {
    const found: Record<string, RowMark> = {};
    for (const group of groups) {
      for (const node of group.pinned) found[node.thread.id] = { kind: "pinned" };
      if (!group.lead) continue;
      const beat = studio.heartbeats[group.space.id] ?? null;
      const role = group.space.isDefault ? "Chief of Staff" : "Space lead";
      found[group.lead.thread.id] = { kind: group.space.isDefault ? "chief" : "lead", label: beat ? `${role} · heartbeat ${cadenceLabel(beat)}` : role };
    }
    return found;
  }, [groups, studio.heartbeats]);

  const collapsedThreads = useMemo(() => new Set(prefs.collapsedThreads), [prefs.collapsedThreads]);
  const rowContext: RowContextValue = {
    activeThreadId,
    lines,
    marks,
    collapsed: collapsedThreads,
    toggleCollapsed: (id) => setPref("collapsedThreads", (current) => current.includes(id) ? current.filter((each) => each !== id) : [...current, id]),
    spaces,
    spaceIdOf: resolve,
    leads,
    hidden: new Set(prefs.hiddenThreads),
    setHidden: (id, hide) => setPref("hiddenThreads", (current) => hide ? [...current, id] : current.filter((each) => each !== id)),
    moveThreads: studioActions.moveThreads,
    setLead: studioActions.setLead,
    actions,
    onNavigate,
  };

  const newThread = (space: StudioSpace) => {
    handOffNewThreadSpace(space.id, space.defaultProjectId);
    actions.openNewThread(space.defaultProjectId ? { projectId: space.defaultProjectId } : undefined);
    onNavigate();
  };

  let body: ReactNode;
  if (studio.status !== "ready" || !spaces.length) {
    body = (
      <p className="px-3 py-2 text-xs text-muted-foreground">
        {studio.status === "loading" || status === "loading" ? "Loading Spaces…" : `Studio's Spaces aren't available${studio.error ? `: ${studio.error}` : "."}`}
      </p>
    );
  } else {
    body = (
      <div className="space-y-4">
        {pinnedChief ? <section data-chief-of-staff={pinnedChief.thread.id} aria-label="Chief of Staff"><ThreadTree node={pinnedChief} /></section> : null}
        {shown.map((group) => {
          const allHidden = new Set(group.all.filter((thread) => hidden.has(thread.id)).map((thread) => thread.id));
          const hiddenCount = group.all.filter((thread) => allHidden.has(thread.id) && !(thread.parentThreadId && allHidden.has(thread.parentThreadId))).length;
          const isRevealed = revealed.has(group.space.id);
          const drop = isRevealed ? new Set<string>() : allHidden;
          return (
            <SpaceSection
              key={group.space.id}
              group={group}
              studio={studio}
              threads={threads}
              move={studioActions.moveThreads}
              needsYou={isAll && attention.has(group.space.id)}
              collapse={isAll ? { collapsed: collapsedSpaces.has(group.space.id), toggle: () => toggleSpace(group.space.id) } : null}
              hiddenCount={hiddenCount}
              revealed={isRevealed}
              onToggleRevealed={() => setRevealed((current) => {
                const next = new Set(current);
                if (!next.delete(group.space.id)) next.add(group.space.id);
                return next;
              })}
              onNewThread={() => newThread(group.space)}
            >
              {[...(group.lead ? [group.lead] : []), ...prune(group.pinned, drop), ...prune(group.rest, drop)].map((node) => (
                <ThreadTree key={node.thread.id} node={node} />
              ))}
            </SpaceSection>
          );
        })}
      </div>
    );
  }

  return (
    <RowProvider value={rowContext}>
      <SidebarAnchors onNavigate={onNavigate} />
      <div ref={area} data-sidebar-space-area="" className="flex min-w-0 flex-col px-2">
        {body}
        {spaces.length ? <SpaceSwitcher spaces={spaces} currentId={currentId} attention={attention} onSelect={switchTo} move={studioActions.moveThreads} /> : null}
      </div>
    </RowProvider>
  );
}

