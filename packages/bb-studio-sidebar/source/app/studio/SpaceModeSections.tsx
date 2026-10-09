import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAtom, useAtomValue } from "jotai";
import { DndContext, useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { openAppPath } from "@bb-studio/kit/app";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { SidebarControlButton } from "../rows/SidebarRowControls.js";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import type { SidebarThread } from "../model/sidebar-thread.js";
import {
  buildProjectThreadGroups,
  CHRONOLOGICAL_CONTAINER_ID,
  getProjectThreadItemDescendants,
  isSidebarProjectThread,
  type ProjectThreadItem,
  type ThreadComparator,
} from "../model/project-thread-groups.js";
import { getCollapsedChildActivity, threadAttentionState, type ThreadAttentionState } from "../model/thread-activity.js";
import type { SidebarSectionId } from "../model/sidebar-section-id.js";
import { ProjectThreadTree } from "../list/ProjectRow.js";
import {
  buildGroupSectionItem,
  getProjectThreadListState,
  useGroupedModeThreadDnd,
  type BuiltInSectionRenderState,
  type GroupedModePinnedProps,
  type ThreadListStatus,
  type ToggleCollapsedId,
} from "../list/ProjectList.js";
import {
  renderBuiltInSidebarSection,
  SortableSidebarSection,
  type BuiltInSidebarSectionOptions,
  type BuiltInSidebarSectionOptionsById,
} from "../list/BuiltInSidebarSection.js";
import { SectionThreadDragOverlayPortal } from "../list/ProjectRow.js";
import { SectionThreadDndProvider } from "../dnd/SectionThreadDndContext.js";
import type { SectionThreadDndState, SectionThreadGroupMove } from "../dnd/useSectionThreadDnd.js";
import { ThreadListVisibility, ThreadListVisibilityGroupScope } from "../list/ThreadListVisibility.js";
import { SidebarHeaderControls } from "../list/SidebarHeaderControls.js";
import {
  sidebarCollapsedSpacesAtom,
  sidebarCurrentSpaceAtom,
  sidebarGroupThreadsByEnvironmentAtom,
} from "../preferences/atoms.js";
import { toggleCollapsedIdList } from "../list/ProjectList.js";
import {
  buildSpaceThreadGroups,
  createSpaceResolver,
  defaultSpaceId,
  isSpaceDotDropId,
  projectSpaces,
  spaceHeadingDropId,
  spaceIdOfDropKey,
  spaceSectionKey,
  type StudioSpace,
} from "./space-groups.js";
import { useMoveThreadsToSpace } from "./MoveToSpace.js";
import { SpaceNewMenu, SpaceStudioList } from "./SpaceStudioList.js";
import { SpaceBrowseMenu } from "./SpaceBrowseMenu.js";
import { HiddenThreadsMenuItem } from "./HiddenThreads.js";
import { chiefOfStaffOf, SpaceLeadContext, type SpaceLeadState } from "./SpaceLead.js";
import { setSpaceNewThreadTarget } from "./new-thread-space.js";
import { SpaceRowsContext, type SpaceThreadMark } from "./SpaceThreadRow.js";
import { handOffNewThreadSpace } from "./new-thread-space.js";
import { threadLineIds, threadLineStatusKey, useThreadLines } from "./useThreadLines.js";
import {
  ALL_SPACES,
  neighbourSpaceId,
  openSpaceDialog,
  SpaceHeadingMark,
  SpaceSwitcher,
  useFillSidebar,
  useSpaceSwitchGestures,
} from "./SpaceSwitcher.js";
import { useStudioSpaces, type SpaceItems } from "./studioSpaces.js";

export interface SpaceModeSectionsProps
  extends BuiltInSectionRenderState, GroupedModePinnedProps {
  collapsedEnvironmentIds: Set<string>;
  collapsedThreadIds: Set<string>;
  compareThreads: ThreadComparator;
  draftThreadIds: ReadonlySet<string>;
  effectivePinnedThreadIds: ReadonlySet<string>;
  heartbeats: Readonly<Record<string, string | null>>;
  items: Readonly<Record<string, SpaceItems>>;
  leads: Readonly<Record<string, string | null>>;
  onCreateThread?: () => void;
  onCreateThreadInProject: (projectId: string | null) => void;
  onProjectSelect?: () => void;
  onToggleEnvironmentCollapsed: ToggleCollapsedId;
  onToggleThreadCollapsed: ToggleCollapsedId;
  pinnedSection: BuiltInSidebarSectionOptions;
  selectedThreadId?: string;
  spaceOf: Readonly<Record<string, string>>;
  spaces: readonly StudioSpace[];
  status: ThreadListStatus;
  threads: SidebarThread[];
  threadsSection: Omit<BuiltInSidebarSectionOptions, "content">;
}

const noop = () => {};

// A question blocks its thread, so it outranks a failure, which outranks a result.
const WAIT_RANK: Record<ThreadAttentionState, number> = { "needs-you": 0, error: 1, unread: 2, working: 3, idle: 3 };

/**
 * Items with a thread that waits on the user, its own or a sub-thread's, come
 * first: questions, then unread errors, then unread results. Items in the same
 * tier keep their order.
 */
export function needsYouFirst(items: readonly ProjectThreadItem[]): ProjectThreadItem[] {
  const rank = (item: ProjectThreadItem) =>
    Math.min(WAIT_RANK.idle, ...getProjectThreadItemDescendants([item]).map((thread) => WAIT_RANK[threadAttentionState(thread)]));
  const ranks = new Map(items.map((item) => [item, rank(item)]));
  return [...items].sort((left, right) => ranks.get(left)! - ranks.get(right)!);
}

/** Whether `thread` is the Chief of Staff or one of its sub-threads, at any depth. */
export function chiefUnder(threads: readonly SidebarThread[], chiefId: string | null, thread: SidebarThread): boolean {
  if (!chiefId) return false;
  const byId = new Map(threads.map((candidate) => [candidate.id, candidate]));
  const seen = new Set<string>();
  for (let id: string | null = thread.id; id !== null && !seen.has(id); id = byId.get(id)?.parentThreadId ?? null) {
    if (id === chiefId) return true;
    seen.add(id);
  }
  return false;
}

/** "every5minutes" reads "every 5 minutes". */
function cadenceLabel(cadence: string): string {
  return cadence.replace(/^every(\d+)(\w+)$/u, "every $1 $2");
}

/**
 * By space: one Space at a time, Arc-style, or All of them stacked. The
 * default Space is the top level and shows first with no heading: its lead,
 * the Chief of Staff, with its workers nested, then every unfiled thread. The
 * Chief of Staff also stays at the top of every other Space's view. Other
 * Spaces show their lead on top, their open Studio items and their threads;
 * threads in no Space belong to the default Space. Dots pinned to the bottom switch between
 * All and each Space, as do ⌃⌥← / ⌃⌥→ and a horizontal swipe over the list.
 * Thread rows get two lines: a status dot, the title and its age, then the
 * thread's latest line from Studio.
 */
export function SpaceModeSections({
  collapsedEnvironmentIds,
  collapsedSectionIds,
  collapsedThreadIds,
  compareThreads,
  draftThreadIds,
  effectivePinnedThreadIds,
  heartbeats,
  items,
  leads,
  onCreateThreadInProject,
  onProjectSelect,
  onToggleCollapsed,
  onToggleEnvironmentCollapsed,
  onToggleThreadCollapsed,
  pinnedReorderPending,
  pinnedRootItems,
  pinnedRootNodes,
  pinnedSection,
  pinnedThreads,
  onReorderPinnedThread,
  selectedThreadId,
  showPinnedSection,
  spaceOf,
  spaces,
  status,
  threads,
  threadsSection,
}: SpaceModeSectionsProps) {
  const groupThreadsByEnvironment = useAtomValue(sidebarGroupThreadsByEnvironmentAtom);
  const studioState = useStudioSpaces();
  const chiefId = chiefOfStaffOf(studioState);
  const [storedSpaceId, setStoredSpaceId] = useAtom(sidebarCurrentSpaceAtom);
  const fallbackSpaceId = defaultSpaceId(spaces);
  const isAll = storedSpaceId === ALL_SPACES && spaces.length > 0;
  const currentSpace = isAll ? null
    : spaces.find((space) => space.id === storedSpaceId)
      ?? spaces.find((space) => space.id === fallbackSpaceId)
      ?? null;
  const currentId = isAll ? ALL_SPACES : currentSpace?.id ?? null;
  const switchTo = useCallback((spaceId: string) => setStoredSpaceId(spaceId), [setStoredSpaceId]);
  const [collapsedSpaceList, setCollapsedSpaceList] = useAtom(sidebarCollapsedSpacesAtom);
  const collapsedSpaces = useMemo(() => new Set(collapsedSpaceList), [collapsedSpaceList]);
  const toggleSpaceCollapsed = useCallback(
    (spaceId: string) => setCollapsedSpaceList((current) => toggleCollapsedIdList({ current, id: spaceId })),
    [setCollapsedSpaceList],
  );
  const resolveSpace = useMemo(
    () => createSpaceResolver(threads, spaceOf, new Set(spaces.map((space) => space.id)), fallbackSpaceId, projectSpaces(spaces)),
    [fallbackSpaceId, spaceOf, spaces, threads],
  );
  const leadState = useMemo<SpaceLeadState>(() => ({ spaceIdOf: resolveSpace, leads }), [leads, resolveSpace]);
  const attention = useMemo(() => new Set(threads.flatMap((thread) => {
    const spaceId = thread.hasPendingInteraction ? resolveSpace(thread) : null;
    return spaceId ? [spaceId] : [];
  })), [resolveSpace, threads]);

  // Opening a thread from elsewhere shows its Space; All expands it.
  const revealedFor = useRef<string | undefined>(undefined);
  // BB's New thread starts in the Space shown, as the Space's + does (Studio
  // Navigation reads this). All, or no Space, leaves New thread to bb.
  const newThreadProjectId = currentSpace?.defaultProjectId ?? null;
  const newThreadSpaceId = newThreadProjectId ? currentSpace?.id ?? null : null;
  useEffect(() => {
    setSpaceNewThreadTarget(
      newThreadProjectId && newThreadSpaceId ? { spaceId: newThreadSpaceId, projectId: newThreadProjectId } : null,
    );
  }, [newThreadProjectId, newThreadSpaceId]);
  useEffect(() => () => setSpaceNewThreadTarget(null), []);
  useEffect(() => {
    if (!selectedThreadId || revealedFor.current === selectedThreadId) return;
    const thread = threads.find((candidate) => candidate.id === selectedThreadId);
    if (!thread) return;
    revealedFor.current = selectedThreadId;
    const spaceId = resolveSpace(thread);
    // The Chief of Staff and its workers show in every view.
    if (spaceId === fallbackSpaceId && chiefUnder(threads, chiefId, thread)) return;
    if (!spaceId) return;
    if (isAll) {
      if (collapsedSpaces.has(spaceId)) toggleSpaceCollapsed(spaceId);
    } else if (spaceId !== currentSpace?.id) switchTo(spaceId);
  }, [chiefId, collapsedSpaces, currentSpace?.id, fallbackSpaceId, isAll, resolveSpace, selectedThreadId, switchTo, threads, toggleSpaceCollapsed]);

  const area = useRef<HTMLDivElement>(null);
  useFillSidebar(area);
  useSpaceSwitchGestures(area, (step) => {
    const next = neighbourSpaceId(spaces, currentId, step);
    if (next && next !== currentId) switchTo(next);
  });

  // With Spaces, a pinned thread sits at the top of its own Space instead of a Pinned section.
  const pinsInSpaces = spaces.length > 0;
  const nonPinnedThreads = useMemo(
    () => threads.filter((thread) => (pinsInSpaces || !effectivePinnedThreadIds.has(thread.id)) && isSidebarProjectThread(thread)),
    [effectivePinnedThreadIds, pinsInSpaces, threads],
  );
  const pinnedIds = useMemo(() => pinsInSpaces ? pinnedThreads.map((thread) => thread.id) : [], [pinnedThreads, pinsInSpaces]);
  const { groups, loose } = useMemo(
    () => buildSpaceThreadGroups(nonPinnedThreads, spaces, spaceOf, leads, pinnedIds),
    [leads, nonPinnedThreads, pinnedIds, spaceOf, spaces],
  );
  const built = useMemo(() => groups
    .map((found) => {
      const sectionId = spaceSectionKey(found.space.id);
      const item = buildGroupSectionItem(found.space.id, sectionId, found.space.name, found.threads, compareThreads, draftThreadIds, groupThreadsByEnvironment);
      item.group.items = needsYouFirst(item.group.items);
      const leadThreads = found.lead ? [found.lead, ...found.leadChildren] : [];
      const leadItems = buildProjectThreadGroups(leadThreads, compareThreads, draftThreadIds, false);
      // Pins keep their pin order; their sub-threads nest under them as usual.
      const pinOrder = new Map(found.pinned.map((thread, index) => [thread.id, index]));
      const pinnedThreadsHere = [...found.pinned, ...found.pinnedChildren];
      const pinnedItems = buildProjectThreadGroups(
        pinnedThreadsHere,
        (a, b) => (pinOrder.get(a.id) ?? Infinity) - (pinOrder.get(b.id) ?? Infinity) || compareThreads(a, b),
        draftThreadIds,
        false,
      );
      const all = [...leadThreads, ...pinnedThreadsHere, ...found.threads];
      return { ...found, sectionId, item, leadThreads, leadItems, pinnedThreadsHere, pinnedItems, all, activity: getCollapsedChildActivity(all, draftThreadIds) };
    }), [compareThreads, draftThreadIds, groupThreadsByEnvironment, groups]);
  // The Spaces on show: the current one, or every one in All.
  const shown = useMemo(() => built.filter((candidate) => isAll || candidate.space.id === currentSpace?.id), [built, currentSpace?.id, isAll]);
  // The top level's lead, the Chief of Staff, with its workers: pinned above another Space shown alone.
  const top = built.find((candidate) => candidate.space.isDefault) ?? null;
  const pinnedChief = top?.lead && !shown.includes(top) ? top : null;
  const shownBySection = useMemo(() => new Map(shown.map((candidate) => [candidate.sectionId as SidebarSectionId, candidate])), [shown]);

  // Latest lines for the threads on show: leads first, then by recency.
  const lineIds = useMemo(() => {
    const open = shown.filter((candidate) => !isAll || !collapsedSpaces.has(candidate.space.id));
    return threadLineIds(
      [...(pinnedChief?.lead ? [pinnedChief.lead] : []), ...open.flatMap((candidate) => candidate.lead ? [candidate.lead] : [])],
      [...(pinnedChief?.leadChildren ?? []), ...open.flatMap((candidate) => [...candidate.leadChildren, ...candidate.pinnedThreadsHere, ...candidate.threads]), ...pinnedThreads],
    );
  }, [collapsedSpaces, isAll, pinnedChief, pinnedThreads, shown]);
  const lines = useThreadLines(lineIds, useMemo(() => threadLineStatusKey(threads, lineIds), [lineIds, threads]));
  // The lead and pinned threads are told apart by a mark in place of their dot, not a heading.
  const marks = useMemo(() => {
    const found: Record<string, SpaceThreadMark> = {};
    for (const candidate of shown) {
      for (const thread of candidate.pinned) found[thread.id] = { kind: "pinned" };
    }
    for (const candidate of pinnedChief ? [...shown, pinnedChief] : shown) {
      if (!candidate.lead) continue;
      const heartbeat = heartbeats[candidate.space.id] ?? null;
      const role = candidate.space.isDefault ? "Chief of Staff" : "Space lead";
      found[candidate.lead.id] = { kind: candidate.space.isDefault ? "chief" : "lead", label: heartbeat ? `${role} · heartbeat ${cadenceLabel(heartbeat)}` : role };
    }
    return found;
  }, [heartbeats, pinnedChief, shown]);
  const rows = useMemo(() => ({ lines, marks }), [lines, marks]);

  const showThreads = spaces.length === 0;
  const order = useMemo<SidebarSectionId[]>(
    () => [
      ...(showPinnedSection && !pinsInSpaces ? ["pinned" as const] : []),
      ...shown.map((candidate) => candidate.sectionId),
      ...(showThreads ? ["threads" as const] : []),
    ],
    [pinsInSpaces, shown, showPinnedSection, showThreads],
  );
  const looseItems = useMemo<ProjectThreadItem[]>(
    () => buildProjectThreadGroups(loose, compareThreads, draftThreadIds, groupThreadsByEnvironment),
    [compareThreads, draftThreadIds, groupThreadsByEnvironment, loose],
  );
  const rootItems = useMemo<ProjectThreadItem[]>(
    () => [...looseItems, ...shown.map((candidate) => candidate.item)],
    [looseItems, shown],
  );
  // A thread dropped on a Space's heading, list or dot moves into that Space.
  const moveThreads = useMoveThreadsToSpace();
  const groupMove = useMemo<SectionThreadGroupMove>(() => {
    const byId = new Map(threads.map((thread) => [thread.id, thread]));
    const spaceOfKey = (key: string) => {
      const spaceId = spaceIdOfDropKey(key);
      return spaceId === null ? null : spaces.find((space) => space.id === spaceId) ?? null;
    };
    return {
      target: (key, threadIds) => {
        const space = spaceOfKey(key);
        if (!space) return null;
        const moves = threadIds.some((id) => {
          const thread = byId.get(id);
          return !thread || resolveSpace(thread) !== space.id;
        });
        return moves ? spaceSectionKey(space.id) : null;
      },
      ownsDroppable: isSpaceDotDropId,
      move: (key, threadIds) => {
        const space = spaceOfKey(key);
        return space ? moveThreads(threadIds, space) : Promise.resolve();
      },
    };
  }, [moveThreads, resolveSpace, spaces, threads]);
  // Threads still nest by dropping one onto another; sections don't reorder.
  const threadDnd = useGroupedModeThreadDnd({
    collapsedThreadIds,
    compareThreads,
    draftThreadIds,
    onToggleThreadCollapsed,
    order,
    onOrderChange: noop,
    pinned: { pinnedReorderPending, pinnedRootItems, pinnedRootNodes, pinnedThreads, onReorderPinnedThread },
    rootItems,
    threads: nonPinnedThreads,
    groupMove,
  });

  const tree = (props: { rootItems: ProjectThreadItem[]; threads: SidebarThread[]; dndParentKey?: string }) => (
    <ProjectThreadTree
      {...(props.dndParentKey ? { dndParentKey: props.dndParentKey } : {})}
      rootItems={props.rootItems}
      threadListState={props.dndParentKey === CHRONOLOGICAL_CONTAINER_ID ? getProjectThreadListState({ status, threads: props.threads }) : { status: "ready", threads: props.threads }}
      compareThreads={compareThreads}
      variant="section"
      selectedThreadId={selectedThreadId}
      collapsedThreadIds={collapsedThreadIds}
      collapsedEnvironmentIds={collapsedEnvironmentIds}
      onProjectSelect={onProjectSelect}
      onToggleThreadCollapsed={onToggleThreadCollapsed}
      onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
    />
  );
  const builtInSections: BuiltInSidebarSectionOptionsById = {
    pinned: pinnedSection,
    threads: {
      ...threadsSection,
      activity: getCollapsedChildActivity(loose, draftThreadIds),
      collapsedThreads: loose,
      content: tree({ rootItems: looseItems, threads: loose, dndParentKey: CHRONOLOGICAL_CONTAINER_ID }),
    },
  };

  return (
    <SpaceLeadContext.Provider value={leadState}>
      <SpaceRowsContext.Provider value={rows}>
      <SpaceDndScope threadDnd={threadDnd}>
      <div ref={area} data-sidebar-space-area="" className="flex min-w-0 flex-col">
        <ThreadListVisibility groups={[]} order={[]} onOrderChange={noop} label="Spaces" selectedThreadId={selectedThreadId}>
          <SortableContext items={order} strategy={verticalListSortingStrategy}>
            <div className="space-y-5">
            {pinnedChief?.lead ? (
              <section data-chief-of-staff={pinnedChief.lead.id} aria-label="Chief of Staff">
                {/* The top level's lead stays on top of every Space; its row's mark is an avatar. */}
                {tree({ rootItems: pinnedChief.leadItems, threads: pinnedChief.leadThreads, dndParentKey: pinnedChief.sectionId })}
              </section>
            ) : null}
            {order.map((sectionId) => {
              const consumeClickSuppression = threadDnd?.consumeClickSuppression ?? (() => false);
              const builtInSection = renderBuiltInSidebarSection({
                sectionId,
                sections: builtInSections,
                disabled: true,
                collapsedSectionIds,
                onToggleCollapsed,
                consumeClickSuppression,
                showPinnedSection,
              });
              if (builtInSection !== undefined) {
                return sectionId === "threads" ? (
                  <ThreadListVisibilityGroupScope key={sectionId} id={sectionId}>
                    {builtInSection}
                  </ThreadListVisibilityGroupScope>
                ) : builtInSection;
              }
              const group = shownBySection.get(sectionId);
              if (!group) return null;
              // The composer's Space picker starts on this Space.
              const newThread = () => {
                handOffNewThreadSpace(group.space.id, group.space.defaultProjectId);
                onCreateThreadInProject(group.space.defaultProjectId);
              };
              const body = (
                <>
                  {/* Open Studio items as chips, then the lead, pins and threads, told apart by their marks. */}
                  <SpaceStudioList spaceName={group.space.name} items={items[group.space.id]} />
                  {group.lead ? (
                    <div data-space-lead={group.lead.id} {...(group.space.isDefault ? { "data-chief-of-staff": group.lead.id } : {})}>
                      {/* Takes drops, so a thread dragged onto the lead nests under it as its worker. */}
                      {tree({ rootItems: group.leadItems, threads: group.leadThreads, dndParentKey: sectionId })}
                    </div>
                  ) : null}
                  {group.pinned.length ? (
                    <div data-space-pinned="">
                      {tree({ rootItems: group.pinnedItems, threads: group.pinnedThreadsHere })}
                    </div>
                  ) : null}
                  {/* No placeholder when there are none: the whole Space still takes dropped threads. */}
                  {group.threads.length ? tree({ rootItems: group.item.group.items, threads: group.threads, dndParentKey: sectionId }) : null}
                </>
              );
              // The top level has no heading: it's where everything lives until it's filed into a Space.
              if (group.space.isDefault) return (
                <ThreadListVisibilityGroupScope key={sectionId} id={sectionId}>
                  <SpaceDropArea spaceId={group.space.id}>
                    <section data-space-top-level="" aria-label="Home">{body}</section>
                  </SpaceDropArea>
                </ThreadListVisibilityGroupScope>
              );
              return (
                <ThreadListVisibilityGroupScope key={sectionId} id={sectionId}>
                  <SpaceDropArea spaceId={group.space.id}>
                  <SpaceSidebarSection
                    space={group.space}
                    sectionId={group.sectionId}
                    onNewThread={newThread}
                    activity={group.activity}
                    threads={group.all}
                    consumeClickSuppression={consumeClickSuppression}
                    needsYou={isAll && attention.has(group.space.id)}
                    collapse={isAll ? { isCollapsed: collapsedSpaces.has(group.space.id), onToggleCollapsed: () => toggleSpaceCollapsed(group.space.id) } : undefined}
                    headerActions={(
                      <>
                        <SpaceBrowseMenu space={group.space} spaces={spaces} spaceOf={spaceOf} activeThreads={threads} items={items[group.space.id]} />
                        <SpaceNewMenu
                          spaceId={group.space.id}
                          spaceName={group.space.name}
                          defaultProjectId={group.space.defaultProjectId}
                          onNewThread={newThread}
                        />
                      </>
                    )}
                  >
                    {body}
                  </SpaceSidebarSection>
                  </SpaceDropArea>
                </ThreadListVisibilityGroupScope>
              );
            })}
            </div>
          </SortableContext>
        </ThreadListVisibility>
        {spaces.length ? (
          <SpaceSwitcher spaces={spaces} currentId={currentId} attention={attention} onSelect={switchTo} />
        ) : null}
      </div>
      </SpaceDndScope>
      </SpaceRowsContext.Provider>
    </SpaceLeadContext.Provider>
  );
}

/**
 * The threads' drag and drop around the whole By space area, so the Space
 * dots below the list take drops too.
 */
function SpaceDndScope({ threadDnd, children }: { threadDnd: SectionThreadDndState | null; children: ReactNode }) {
  if (!threadDnd) return <>{children}</>;
  return (
    <SectionThreadDndProvider value={threadDnd}>
      <DndContext {...threadDnd.dndContextProps}>
        {children}
        <SectionThreadDragOverlayPortal activeThread={threadDnd.activeThread} />
      </DndContext>
    </SectionThreadDndProvider>
  );
}

/** A Space section, its heading a drop target for threads moving in. */
function SpaceDropArea({ spaceId, children }: { spaceId: string; children: ReactNode }) {
  const { setNodeRef } = useDroppable({ id: spaceHeadingDropId(spaceId) });
  // Whitespace between Spaces (space-y above) and the tiled emoji set each one apart; no rules or boxes.
  return <div ref={setNodeRef} data-space-drop={spaceId}>{children}</div>;
}

const COMMAND_PLUGIN_ID = "studio";
let commandInstalled: Promise<boolean> | null = null;
let commandCheckedFor: unknown = null;

type Sdk = ReturnType<typeof useSdk>;

/** One check per window, redone once per BB plugins change however many headings ask. */
function checkCommandInstalled(sdk: Sdk, change?: unknown): Promise<boolean> {
  if (change !== undefined && change !== commandCheckedFor) {
    commandCheckedFor = change;
    commandInstalled = null;
  }
  commandInstalled ??= sdk.plugins.list().then(
    ({ plugins }) => plugins.some((plugin) => plugin.id === COMMAND_PLUGIN_ID && plugin.enabled && plugin.status !== "error" && plugin.status !== "incompatible"),
    () => false,
  );
  return commandInstalled;
}

/** Whether Studio is installed and running; checked again when BB's plugins change. */
export function useCommandInstalled(): boolean {
  const sdk = useSdk();
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    let live = true;
    let latest = 0;
    const apply = (check: Promise<boolean>) => {
      const call = ++latest;
      void check.then((value) => {
        if (live && call === latest) setInstalled(value);
      });
    };
    apply(checkCommandInstalled(sdk));
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = sdk.subscribe({
        event: "system:changed",
        callback: (event) => {
          if (event.changes.includes("plugins-changed")) apply(checkCommandInstalled(sdk, event));
        },
      });
    } catch {
      // No realtime here: the first check stands.
    }
    return () => {
      live = false;
      unsubscribe?.();
    };
  }, [sdk]);
  return installed;
}

/** Forget the cached Studio check. */
export function resetCommandInstalledForTest(): void {
  commandInstalled = null;
  commandCheckedFor = null;
}

/**
 * A Space's plain heading: its mark (amber-dotted in All when a thread there
 * needs the user) and name, a Command view button, and ⋯ with New thread,
 * Command view, Threads…, Projects…, Edit and Delete. In All it collapses.
 */
function SpaceSidebarSection({
  space,
  sectionId,
  onNewThread,
  activity,
  threads,
  consumeClickSuppression,
  needsYou = false,
  collapse,
  headerActions,
  children,
}: {
  space: StudioSpace;
  sectionId: SidebarSectionId;
  onNewThread: () => void;
  activity: ReturnType<typeof getCollapsedChildActivity>;
  threads: readonly SidebarThread[];
  consumeClickSuppression?: Parameters<typeof SortableSidebarSection>[0]["consumeClickSuppression"];
  needsYou?: boolean;
  collapse?: { isCollapsed: boolean; onToggleCollapsed: () => void };
  /** Browse (items and archived threads), and + for a new thread or item. */
  headerActions: ReactNode;
  children: ReactNode;
}) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const command = useCommandInstalled();
  const openCommand = () => openAppPath(`/plugins/${COMMAND_PLUGIN_ID}/studio/command/${encodeURIComponent(space.id)}`);
  return (
    <SortableSidebarSection
      id={sectionId}
      sectionId={sectionId}
      label={space.name}
      labelMark={needsYou ? (
        <span className="relative inline-flex">
          <SpaceHeadingMark space={space} />
          <span data-space-needs-you="" role="img" aria-label="Needs you" className="absolute -top-0.5 right-0.5 size-2 rounded-full bg-warning ring-2 ring-sidebar" />
        </span>
      ) : <SpaceHeadingMark space={space} />}
      collapseControl={collapse}
      disabled
      dropParentKey={sectionId}
      actionsMobileAlways
      actionsOpen={actionsOpen}
      actions={(
        <SidebarHeaderControls
          label={space.name}
          sectionId={sectionId}
          showNewThread={false}
          leadingAction={(
            <span className="inline-flex items-center gap-0.5 has-[[data-state=open]]:pointer-events-auto">
              {command ? <SidebarControlButton label={`Command view for ${space.name}`} icon="GridView" onClick={openCommand} /> : null}
              {headerActions}
            </span>
          )}
          onNewThread={onNewThread}
          open={actionsOpen}
          onOpenChange={setActionsOpen}
        >
          <DropdownMenuItem onSelect={onNewThread}>
            <Icon name="MessageSquarePlus" />
            New thread here
          </DropdownMenuItem>
          {command ? (
            <DropdownMenuItem onSelect={openCommand}>
              <Icon name="GridView" />
              Command view
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => openSpaceDialog(space.id, "threads")}>
            <Icon name="MessageSquare" />
            Threads…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openSpaceDialog(space.id, "projects")}>
            <Icon name="Folder" />
            Projects…
          </DropdownMenuItem>
          <HiddenThreadsMenuItem sectionKey={sectionId} />
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => openSpaceDialog(space.id, "heartbeat")}>
            <Icon name="Star" />
            Lead and heartbeat…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openSpaceDialog(space.id, "edit")}>
            <Icon name="Edit" />
            Edit Space
          </DropdownMenuItem>
          {space.isDefault ? null : (
            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => openSpaceDialog(space.id, "delete")}>
              <Icon name="Trash2" />
              Delete Space
            </DropdownMenuItem>
          )}
        </SidebarHeaderControls>
      )}
      collapsedActivity={activity}
      collapsedThreads={threads}
      consumeClickSuppression={consumeClickSuppression}
    >
      {children}
    </SortableSidebarSection>
  );
}
