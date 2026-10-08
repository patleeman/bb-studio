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
  SpaceMark,
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

/**
 * The Chief of Staff and its sub-threads, at any depth, and every other
 * thread. With no Chief of Staff, or one not listed, everything is `rest`.
 */
export function splitChiefOfStaff(
  threads: readonly SidebarThread[],
  chiefId: string | null,
): { chief: SidebarThread[]; rest: SidebarThread[] } {
  if (!chiefId || !threads.some((thread) => thread.id === chiefId)) return { chief: [], rest: [...threads] };
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const under = (thread: SidebarThread) => {
    const seen = new Set<string>();
    for (let id: string | null = thread.id; id !== null && !seen.has(id); id = byId.get(id)?.parentThreadId ?? null) {
      if (id === chiefId) return true;
      seen.add(id);
    }
    return false;
  };
  const chief: SidebarThread[] = [];
  const rest: SidebarThread[] = [];
  for (const thread of threads) (under(thread) ? chief : rest).push(thread);
  return { chief, rest };
}

/** "every5minutes" reads "every 5 minutes". */
function cadenceLabel(cadence: string): string {
  return cadence.replace(/^every(\d+)(\w+)$/u, "every $1 $2");
}

/**
 * By space: one Space at a time, Arc-style, or All of them stacked. A Space
 * shows its lead on top, its open Studio items and its threads; threads in no
 * Space belong to the default Space. Dots pinned to the bottom switch between
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
  const chiefHeartbeat = studioState.status === "ready" ? studioState.chiefOfStaffHeartbeat : null;
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
    // The Chief of Staff shows above every Space.
    if (splitChiefOfStaff(threads, chiefId).chief.some((candidate) => candidate.id === thread.id)) return;
    const spaceId = resolveSpace(thread);
    if (!spaceId) return;
    if (isAll) {
      if (collapsedSpaces.has(spaceId)) toggleSpaceCollapsed(spaceId);
    } else if (spaceId !== currentSpace?.id) switchTo(spaceId);
  }, [chiefId, collapsedSpaces, currentSpace?.id, isAll, resolveSpace, selectedThreadId, switchTo, threads, toggleSpaceCollapsed]);

  const area = useRef<HTMLDivElement>(null);
  useFillSidebar(area);
  useSpaceSwitchGestures(area, (step) => {
    const next = neighbourSpaceId(spaces, currentId, step);
    if (next && next !== currentId) switchTo(next);
  });

  // With Spaces, a pinned thread sits at the top of its own Space instead of a Pinned section.
  const pinsInSpaces = spaces.length > 0;
  // The Chief of Staff is in no Space: it's pinned above them all, the same in every one.
  const { chief: chiefThreads, rest: spaceThreads } = useMemo(() => splitChiefOfStaff(threads, chiefId), [chiefId, threads]);
  const chiefItems = useMemo(
    () => buildProjectThreadGroups(chiefThreads, compareThreads, draftThreadIds, false),
    [chiefThreads, compareThreads, draftThreadIds],
  );
  const nonPinnedThreads = useMemo(
    () => spaceThreads.filter((thread) => (pinsInSpaces || !effectivePinnedThreadIds.has(thread.id)) && isSidebarProjectThread(thread)),
    [effectivePinnedThreadIds, pinsInSpaces, spaceThreads],
  );
  const pinnedIds = useMemo(() => pinsInSpaces ? pinnedThreads.map((thread) => thread.id) : [], [pinnedThreads, pinsInSpaces]);
  const { groups, loose } = useMemo(
    () => buildSpaceThreadGroups(nonPinnedThreads, spaces, spaceOf, leads, pinnedIds),
    [leads, nonPinnedThreads, pinnedIds, spaceOf, spaces],
  );
  // The Spaces on show: the current one, or every one in All.
  const shown = useMemo(() => groups
    .filter((candidate) => isAll || candidate.space.id === currentSpace?.id)
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
    }), [compareThreads, currentSpace?.id, draftThreadIds, groupThreadsByEnvironment, groups, isAll]);
  const shownBySection = useMemo(() => new Map(shown.map((candidate) => [candidate.sectionId as SidebarSectionId, candidate])), [shown]);

  // Latest lines for the threads on show: leads first, then by recency.
  const lineIds = useMemo(() => {
    const open = shown.filter((candidate) => !isAll || !collapsedSpaces.has(candidate.space.id));
    return threadLineIds(
      [...chiefThreads.filter((thread) => thread.id === chiefId), ...open.flatMap((candidate) => candidate.lead ? [candidate.lead] : [])],
      [...chiefThreads.filter((thread) => thread.id !== chiefId), ...open.flatMap((candidate) => [...candidate.leadChildren, ...candidate.pinnedThreadsHere, ...candidate.threads]), ...pinnedThreads],
    );
  }, [chiefId, chiefThreads, collapsedSpaces, isAll, pinnedThreads, shown]);
  const lines = useThreadLines(lineIds, useMemo(() => threadLineStatusKey(threads, lineIds), [lineIds, threads]));
  // The lead and pinned threads are told apart by a mark in place of their dot, not a heading.
  const marks = useMemo(() => {
    const found: Record<string, SpaceThreadMark> = {};
    for (const candidate of shown) {
      for (const thread of candidate.pinned) found[thread.id] = { kind: "pinned" };
      if (candidate.lead) {
        const heartbeat = heartbeats[candidate.space.id] ?? null;
        found[candidate.lead.id] = { kind: "lead", label: heartbeat ? `Space lead · heartbeat ${cadenceLabel(heartbeat)}` : "Space lead" };
      }
    }
    if (chiefId) found[chiefId] = { kind: "chief", label: chiefHeartbeat ? `Chief of Staff · heartbeat ${cadenceLabel(chiefHeartbeat)}` : "Chief of Staff" };
    return found;
  }, [chiefHeartbeat, chiefId, heartbeats, shown]);
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
            <div className="space-y-4">
            {chiefThreads.length ? (
              <section data-chief-of-staff={chiefId ?? undefined} aria-label="Chief of Staff" className="mt-2">
                {/* Labelled like a Space heading, so it reads as its own section above them. */}
                <div className="flex items-center gap-1.5 px-2 pb-1 text-[13px] font-semibold text-sidebar-foreground">
                  <Icon name="UserRound" aria-hidden="true" className="size-3.5" />
                  Chief of Staff
                </div>
                {tree({ rootItems: chiefItems, threads: chiefThreads })}
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
                    {/* Open Studio items as chips, then the lead, pins and threads, told apart by their marks. */}
                    <SpaceStudioList spaceName={group.space.name} items={items[group.space.id]} />
                    {group.lead ? (
                      <div data-space-lead={group.lead.id}>
                        {tree({ rootItems: group.leadItems, threads: group.leadThreads })}
                      </div>
                    ) : null}
                    {group.pinned.length ? (
                      <div data-space-pinned="">
                        {tree({ rootItems: group.pinnedItems, threads: group.pinnedThreadsHere })}
                      </div>
                    ) : null}
                    {/* No placeholder when there are none: the whole Space still takes dropped threads. */}
                    {group.threads.length ? tree({ rootItems: group.item.group.items, threads: group.threads, dndParentKey: sectionId }) : null}
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

/** A Space section, ruled off above, its heading a drop target for threads moving in. */
function SpaceDropArea({ spaceId, children }: { spaceId: string; children: ReactNode }) {
  const { setNodeRef } = useDroppable({ id: spaceHeadingDropId(spaceId) });
  // A rule above each Space sets it apart from the one before.
  return <div ref={setNodeRef} data-space-drop={spaceId} className="border-t border-sidebar-border pt-2">{children}</div>;
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
          <SpaceMark space={space} />
          <span data-space-needs-you="" role="img" aria-label="Needs you" className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-warning" />
        </span>
      ) : <SpaceMark space={space} />}
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
