import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAtom, useAtomValue } from "jotai";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { SIDEBAR_CONTROL_BUTTON_CLASS } from "../rows/sidebarRowClasses.js";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import type { SidebarThread } from "../model/sidebar-thread.js";
import {
  buildProjectThreadGroups,
  CHRONOLOGICAL_CONTAINER_ID,
  isSidebarProjectThread,
  type ProjectThreadItem,
  type ThreadComparator,
} from "../model/project-thread-groups.js";
import { getCollapsedChildActivity } from "../model/thread-activity.js";
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
import { ReorderableSidebarSectionOrderList } from "../list/ReorderableSidebarSectionOrderList.js";
import { ThreadListVisibility, ThreadListVisibilityGroupScope } from "../list/ThreadListVisibility.js";
import { SidebarHeaderControls } from "../list/SidebarHeaderControls.js";
import { sidebarCurrentSpaceAtom, sidebarGroupThreadsByEnvironmentAtom } from "../preferences/atoms.js";
import {
  buildSpaceThreadGroups,
  createSpaceResolver,
  defaultSpaceId,
  spaceSectionKey,
  type StudioSpace,
} from "./space-groups.js";
import { SpaceStudioList, SpaceSubheading } from "./SpaceStudioList.js";
import { SpaceLeadContext, type SpaceLeadState } from "./SpaceLead.js";
import {
  neighbourSpaceId,
  openSpaceDialog,
  SpaceMark,
  SpaceSwitcher,
  useFillSidebar,
  useSpaceSwitchGestures,
} from "./SpaceSwitcher.js";
import type { SpaceItems } from "./studioSpaces.js";

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

/** Items with a thread that needs the user come first, otherwise in order. */
function needsYouFirst(items: readonly ProjectThreadItem[]): ProjectThreadItem[] {
  const needsYou = (item: ProjectThreadItem) =>
    item.kind === "thread" ? item.node.thread.hasPendingInteraction || item.node.stats.childActivity.pending
      : item.kind === "environment" ? item.group.stats.childActivity.pending
        : item.group.activity.pending;
  return [...items.filter(needsYou), ...items.filter((item) => !needsYou(item))];
}

/** "every5minutes" reads "every 5 minutes". */
function cadenceLabel(cadence: string): string {
  return cadence.replace(/^every(\d+)(\w+)$/u, "every $1 $2");
}

/**
 * By space: one Space at a time, Arc-style. The current Space shows its lead
 * on top, its open Studio items and its threads; threads in no Space belong
 * to the default Space. Dots pinned to the bottom switch Spaces, as do
 * ⌃⌥← / ⌃⌥→ and a horizontal swipe over the list.
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
  const [storedSpaceId, setStoredSpaceId] = useAtom(sidebarCurrentSpaceAtom);
  const fallbackSpaceId = defaultSpaceId(spaces);
  const currentSpace = spaces.find((space) => space.id === storedSpaceId)
    ?? spaces.find((space) => space.id === fallbackSpaceId)
    ?? null;
  const switchTo = useCallback((spaceId: string) => setStoredSpaceId(spaceId), [setStoredSpaceId]);

  const resolveSpace = useMemo(
    () => createSpaceResolver(threads, spaceOf, new Set(spaces.map((space) => space.id)), fallbackSpaceId),
    [fallbackSpaceId, spaceOf, spaces, threads],
  );
  const leadState = useMemo<SpaceLeadState>(() => ({ spaceIdOf: resolveSpace, leads }), [leads, resolveSpace]);
  const attention = useMemo(() => new Set(threads.flatMap((thread) => {
    const spaceId = thread.hasPendingInteraction ? resolveSpace(thread) : null;
    return spaceId ? [spaceId] : [];
  })), [resolveSpace, threads]);

  // Opening a thread from elsewhere shows its Space.
  const revealedFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!selectedThreadId || revealedFor.current === selectedThreadId) return;
    const thread = threads.find((candidate) => candidate.id === selectedThreadId);
    if (!thread) return;
    revealedFor.current = selectedThreadId;
    const spaceId = resolveSpace(thread);
    if (spaceId && spaceId !== currentSpace?.id && !effectivePinnedThreadIds.has(thread.id)) switchTo(spaceId);
  }, [currentSpace?.id, effectivePinnedThreadIds, resolveSpace, selectedThreadId, switchTo, threads]);

  const area = useRef<HTMLDivElement>(null);
  useFillSidebar(area);
  useSpaceSwitchGestures(area, (step) => {
    const next = neighbourSpaceId(spaces, currentSpace?.id ?? null, step);
    if (next && next !== currentSpace?.id) switchTo(next);
  });

  const nonPinnedThreads = useMemo(
    () => threads.filter((thread) => !effectivePinnedThreadIds.has(thread.id) && isSidebarProjectThread(thread)),
    [effectivePinnedThreadIds, threads],
  );
  const { groups, loose } = useMemo(
    () => buildSpaceThreadGroups(nonPinnedThreads, spaces, spaceOf, leads),
    [leads, nonPinnedThreads, spaceOf, spaces],
  );
  const group = useMemo(() => {
    const found = groups.find((candidate) => candidate.space.id === currentSpace?.id);
    if (!found) return null;
    const sectionId = spaceSectionKey(found.space.id);
    const item = buildGroupSectionItem(found.space.id, sectionId, found.space.name, found.threads, compareThreads, draftThreadIds, groupThreadsByEnvironment);
    item.group.items = needsYouFirst(item.group.items);
    const leadItems = found.lead ? buildProjectThreadGroups([found.lead], compareThreads, draftThreadIds, false) : [];
    const all = found.lead ? [found.lead, ...found.threads] : found.threads;
    return { ...found, sectionId, item, leadItems, all, activity: getCollapsedChildActivity(all, draftThreadIds) };
  }, [compareThreads, currentSpace?.id, draftThreadIds, groupThreadsByEnvironment, groups]);

  const showThreads = spaces.length === 0;
  const order = useMemo<SidebarSectionId[]>(
    () => [
      ...(showPinnedSection ? ["pinned" as const] : []),
      ...(group ? [group.sectionId] : []),
      ...(showThreads ? ["threads" as const] : []),
    ],
    [group, showPinnedSection, showThreads],
  );
  const looseItems = useMemo<ProjectThreadItem[]>(
    () => buildProjectThreadGroups(loose, compareThreads, draftThreadIds, groupThreadsByEnvironment),
    [compareThreads, draftThreadIds, groupThreadsByEnvironment, loose],
  );
  const rootItems = useMemo<ProjectThreadItem[]>(
    () => [...looseItems, ...(group ? [group.item] : [])],
    [group, looseItems],
  );
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
      <div ref={area} data-sidebar-space-area="" className="flex min-w-0 flex-col">
        <ThreadListVisibility groups={[]} order={[]} onOrderChange={noop} label="Spaces" selectedThreadId={selectedThreadId}>
          <ReorderableSidebarSectionOrderList order={order} threadDnd={threadDnd}>
            {(sectionId, consumeClickSuppression) => {
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
              if (!group || sectionId !== group.sectionId) return null;
              const newThread = () => onCreateThreadInProject(group.space.defaultProjectId);
              const heartbeat = heartbeats[group.space.id] ?? null;
              return (
                <ThreadListVisibilityGroupScope key={sectionId} id={sectionId}>
                  <SpaceSidebarSection
                    space={group.space}
                    sectionId={group.sectionId}
                    onNewThread={newThread}
                    activity={group.activity}
                    threads={group.all}
                    consumeClickSuppression={consumeClickSuppression}
                  >
                    {group.lead ? (
                      <div data-space-lead={group.lead.id} className="mb-1.5 rounded-md bg-sidebar-accent/40 pb-0.5">
                        <div className="flex h-6 items-center gap-1 px-2 text-[11px] text-muted-foreground">
                          <Icon name="Star" className="size-3" aria-hidden="true" />
                          <span className="font-medium">Lead</span>
                          {heartbeat ? <span className="truncate text-subtle-foreground">· heartbeat {cadenceLabel(heartbeat)}</span> : null}
                        </div>
                        {tree({ rootItems: group.leadItems, threads: [group.lead] })}
                      </div>
                    ) : null}
                    <SpaceStudioList
                      spaceId={group.space.id}
                      spaceName={group.space.name}
                      defaultProjectId={group.space.defaultProjectId}
                      items={items[group.space.id]}
                    />
                    <SpaceSubheading
                      title="Threads"
                      action={(
                        <button
                          type="button"
                          aria-label={`New thread in ${group.space.name}`}
                          title="New thread"
                          onClick={newThread}
                          className={cn(SIDEBAR_CONTROL_BUTTON_CLASS, "inline-flex items-center justify-center")}
                        >
                          <Icon name="Plus" className="size-3.5" />
                        </button>
                      )}
                    />
                    {tree({ rootItems: group.item.group.items, threads: group.threads, dndParentKey: sectionId })}
                  </SpaceSidebarSection>
                </ThreadListVisibilityGroupScope>
              );
            }}
          </ReorderableSidebarSectionOrderList>
        </ThreadListVisibility>
        {spaces.length ? (
          <SpaceSwitcher spaces={spaces} currentId={currentSpace?.id ?? null} attention={attention} onSelect={switchTo} />
        ) : null}
      </div>
    </SpaceLeadContext.Provider>
  );
}

/** The current Space's plain heading: its mark and name, and ⋯ with New thread, Edit and Delete. */
function SpaceSidebarSection({
  space,
  sectionId,
  onNewThread,
  activity,
  threads,
  consumeClickSuppression,
  children,
}: {
  space: StudioSpace;
  sectionId: SidebarSectionId;
  onNewThread: () => void;
  activity: ReturnType<typeof getCollapsedChildActivity>;
  threads: readonly SidebarThread[];
  consumeClickSuppression?: Parameters<typeof SortableSidebarSection>[0]["consumeClickSuppression"];
  children: ReactNode;
}) {
  const [actionsOpen, setActionsOpen] = useState(false);
  return (
    <SortableSidebarSection
      id={sectionId}
      sectionId={sectionId}
      label={space.name}
      labelMark={<SpaceMark space={space} />}
      disabled
      dropParentKey={sectionId}
      actionsMobileAlways
      actionsOpen={actionsOpen}
      actions={(
        <SidebarHeaderControls
          label={space.name}
          sectionId={sectionId}
          // New thread and New item live on the Space's Threads and Studio lists.
          showNewThread={false}
          onNewThread={onNewThread}
          open={actionsOpen}
          onOpenChange={setActionsOpen}
        >
          <DropdownMenuItem onSelect={onNewThread}>
            <Icon name="MessageSquarePlus" />
            New thread here
          </DropdownMenuItem>
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
