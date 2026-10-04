import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAtom, useAtomValue } from "jotai";
import { openAppPath, usePathname } from "@bb-studio/kit/app";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { SIDEBAR_CONTROL_BUTTON_CLASS } from "../rows/sidebarRowClasses.js";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import type { SidebarThread } from "../model/sidebar-thread.js";
import {
  buildProjectThreadGroups,
  CHRONOLOGICAL_CONTAINER_ID,
  getProjectThreadItemDescendants,
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
  toggleCollapsedIdList,
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
import {
  ThreadListMore,
  ThreadListVisibility,
  ThreadListVisibilityGroupScope,
  ThreadListVisibilityMenuItems,
  type ThreadListVisibilityGroup,
} from "../list/ThreadListVisibility.js";
import { SidebarHeaderControls } from "../list/SidebarHeaderControls.js";
import {
  sidebarCollapsedSpacesAtom,
  sidebarGroupThreadsByEnvironmentAtom,
  sidebarHiddenGroupsAtom,
} from "../preferences/atoms.js";
import {
  buildSpaceThreadGroups,
  createSpaceResolver,
  spaceHref,
  spaceSectionKey,
  type StudioSpace,
} from "./space-groups.js";
import { openInSpace, threadPath, type OpenInSpaceRequest } from "./openInSpace.js";
import { SpaceStudioList, SpaceSubheading } from "./SpaceStudioList.js";
import type { SpaceItems } from "./studioSpaces.js";

export interface SpaceModeSectionsProps
  extends BuiltInSectionRenderState, GroupedModePinnedProps {
  collapsedEnvironmentIds: Set<string>;
  collapsedThreadIds: Set<string>;
  compareThreads: ThreadComparator;
  draftThreadIds: ReadonlySet<string>;
  effectivePinnedThreadIds: ReadonlySet<string>;
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

/** A Space's emoji, or a dot in its colour. */
export function SpaceMark({ space }: { space: StudioSpace }) {
  return (
    <span data-sidebar-space-mark="" aria-hidden="true" className="inline-flex size-4 shrink-0 items-center justify-center">
      {space.icon
        ? <span className="text-[13px] leading-none">{space.icon}</span>
        : <span className="size-2 rounded-full" style={{ background: space.color }} />}
    </span>
  );
}

const noop = () => {};

/**
 * By space: a section per Studio Space in Studio's order, each with its
 * Studio items and its threads, then Threads for threads in no Space. The
 * heading opens the Space on its lead, which lives there rather than in the
 * list; its workers show with the rest of the Space's threads.
 */
export function SpaceModeSections({
  collapsedEnvironmentIds,
  collapsedSectionIds,
  collapsedThreadIds,
  compareThreads,
  draftThreadIds,
  effectivePinnedThreadIds,
  items,
  leads,
  onCreateThread,
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
  const hiddenGroups = useAtomValue(sidebarHiddenGroupsAtom);
  const [collapsedSpaceList, setCollapsedSpaceList] = useAtom(sidebarCollapsedSpacesAtom);
  const collapsedSpaces = useMemo(() => new Set(collapsedSpaceList), [collapsedSpaceList]);
  const toggleSpaceCollapsed = useCallback<ToggleCollapsedId>(
    (spaceId) => setCollapsedSpaceList((current) => toggleCollapsedIdList({ current, id: spaceId })),
    [setCollapsedSpaceList],
  );
  const nonPinnedThreads = useMemo(
    () => threads.filter((thread) => !effectivePinnedThreadIds.has(thread.id) && isSidebarProjectThread(thread)),
    [effectivePinnedThreadIds, threads],
  );
  const { groups, loose } = useMemo(
    () => buildSpaceThreadGroups(nonPinnedThreads, spaces, spaceOf, leads),
    [leads, nonPinnedThreads, spaceOf, spaces],
  );
  const spaceGroups = useMemo(
    () => groups.map((group) => {
      const sectionId = spaceSectionKey(group.space.id);
      const item = buildGroupSectionItem(
        group.space.id,
        sectionId,
        group.space.name,
        group.threads,
        compareThreads,
        draftThreadIds,
        groupThreadsByEnvironment,
      );
      // The heading's activity still counts the lead, though it isn't listed.
      const all = group.lead ? [group.lead, ...group.threads] : group.threads;
      return { ...group, sectionId, item, all, activity: getCollapsedChildActivity(all, draftThreadIds) };
    }),
    [compareThreads, draftThreadIds, groupThreadsByEnvironment, groups],
  );
  const groupsById = useMemo(() => new Map<string, (typeof spaceGroups)[number]>(spaceGroups.map((group) => [group.sectionId, group])), [spaceGroups]);
  const showThreads = loose.length > 0 || spaces.length === 0;
  const persistedOrder = useMemo<SidebarSectionId[]>(
    () => ["pinned", ...spaceGroups.map((group) => group.sectionId), ...(showThreads ? ["threads" as const] : [])],
    [showThreads, spaceGroups],
  );
  const order = useMemo(() => {
    const hidden = new Set<string>(hiddenGroups);
    return persistedOrder.filter((id) => (id !== "pinned" || showPinnedSection) && !hidden.has(id));
  }, [hiddenGroups, persistedOrder, showPinnedSection]);
  const looseItems = useMemo<ProjectThreadItem[]>(
    () => buildProjectThreadGroups(loose, compareThreads, draftThreadIds, groupThreadsByEnvironment),
    [compareThreads, draftThreadIds, groupThreadsByEnvironment, loose],
  );
  const rootItems = useMemo<ProjectThreadItem[]>(
    () => [...looseItems, ...spaceGroups.map((group) => group.item)],
    [looseItems, spaceGroups],
  );
  // Spaces keep Studio's order, so sections don't reorder by dragging;
  // threads still nest by dropping one onto another.
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

  // Opening a thread expands the Space (or Threads) it sits in.
  const revealedFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!selectedThreadId || revealedFor.current === selectedThreadId) return;
    const group = spaceGroups.find((candidate) => candidate.threads.some((thread) => thread.id === selectedThreadId));
    const isLoose = !group && loose.some((thread) => thread.id === selectedThreadId);
    if (!group && !isLoose) return;
    revealedFor.current = selectedThreadId;
    if (group && collapsedSpaces.has(group.space.id)) toggleSpaceCollapsed(group.space.id);
    if (isLoose && collapsedSectionIds.has("threads")) onToggleCollapsed("threads");
  }, [collapsedSectionIds, collapsedSpaces, loose, onToggleCollapsed, selectedThreadId, spaceGroups, toggleSpaceCollapsed]);

  const looseListState = getProjectThreadListState({ status, threads: loose });
  const looseTree = (onSelect?: () => void) => (
    <ProjectThreadTree
      dndParentKey={CHRONOLOGICAL_CONTAINER_ID}
      rootItems={looseItems}
      threadListState={looseListState}
      compareThreads={compareThreads}
      variant="section"
      selectedThreadId={selectedThreadId}
      collapsedThreadIds={collapsedThreadIds}
      collapsedEnvironmentIds={collapsedEnvironmentIds}
      onProjectSelect={onSelect}
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
      content: looseTree(onProjectSelect),
    },
  };
  const openSpace = (space: StudioSpace, leadThreadId: string | null) => {
    openAppPath(leadThreadId ? threadPath(leadThreadId) : spaceHref(space.id), { main: true });
    onProjectSelect?.();
  };
  const openBeside = (space: StudioSpace, leadThreadId: string | null, request: OpenInSpaceRequest) => {
    // The open thread's Space as the list groups it: a child follows its root.
    const selected = selectedThreadId ? threads.find((thread) => thread.id === selectedThreadId) : undefined;
    const resolveSpace = createSpaceResolver(threads, spaceOf, new Set(spaces.map((candidate) => candidate.id)));
    openInSpace({
      spaceId: space.id,
      leadThreadId,
      currentThreadId: selectedThreadId ?? null,
      currentSpaceId: selected ? resolveSpace(selected) : null,
      request,
      fallbackPath: request.kind === "item" ? request.path : spaceHref(space.id),
    });
    onProjectSelect?.();
  };
  const visibilityGroups: ThreadListVisibilityGroup[] = [
    ...(showThreads ? [{
      id: "threads" as const,
      title: "Threads",
      threads: loose,
      onNewThread: onCreateThread,
      renderContent: (close: () => void) => looseTree(() => { close(); onProjectSelect?.(); }),
    }] : []),
    ...spaceGroups.map((group) => ({
      id: group.sectionId,
      title: group.space.name,
      threads: getProjectThreadItemDescendants(group.item.group.items),
      onNewThread: () => onCreateThreadInProject(group.space.defaultProjectId),
      renderContent: (close: () => void) => (
        <ProjectThreadTree
          rootItems={group.item.group.items}
          threadListState={{ status: "ready", threads: group.threads }}
          compareThreads={compareThreads}
          variant="section"
          selectedThreadId={selectedThreadId}
          collapsedThreadIds={collapsedThreadIds}
          collapsedEnvironmentIds={collapsedEnvironmentIds}
          onProjectSelect={() => { close(); onProjectSelect?.(); }}
          onToggleThreadCollapsed={onToggleThreadCollapsed}
          onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
        />
      ),
    })),
  ];

  return (
    <ThreadListVisibility
      groups={visibilityGroups}
      order={persistedOrder}
      onOrderChange={noop}
      label="Spaces"
      selectedThreadId={selectedThreadId}
    >
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
          const group = groupsById.get(sectionId);
          if (!group) return null;
          return (
            <ThreadListVisibilityGroupScope key={sectionId} id={sectionId}>
              <SpaceSidebarSection
                space={group.space}
                sectionId={group.sectionId}
                onOpen={() => openSpace(group.space, group.leadThreadId)}
                onNewThread={() => onCreateThreadInProject(group.space.defaultProjectId)}
                isCollapsed={collapsedSpaces.has(group.space.id)}
                onToggleCollapsed={() => toggleSpaceCollapsed(group.space.id)}
                activity={group.activity}
                threads={group.all}
                selected={selectedThreadId !== undefined && selectedThreadId === group.leadThreadId}
                consumeClickSuppression={consumeClickSuppression}
              >
                <SpaceStudioList
                  spaceId={group.space.id}
                  spaceName={group.space.name}
                  defaultProjectId={group.space.defaultProjectId}
                  items={items[group.space.id]}
                  onOpen={(request) => openBeside(group.space, group.leadThreadId, request)}
                />
                <SpaceSubheading
                  title="Threads"
                  count={group.threads.length || undefined}
                  action={(
                    <button
                      type="button"
                      aria-label={`New thread in ${group.space.name}`}
                      title="New thread"
                      onClick={() => onCreateThreadInProject(group.space.defaultProjectId)}
                      className={cn(SIDEBAR_CONTROL_BUTTON_CLASS, "inline-flex items-center justify-center")}
                    >
                      <Icon name="Plus" className="size-3.5" />
                    </button>
                  )}
                />
                <ProjectThreadTree
                  dndParentKey={sectionId}
                  rootItems={group.item.group.items}
                  threadListState={{ status: "ready", threads: group.threads }}
                  compareThreads={compareThreads}
                  variant="section"
                  selectedThreadId={selectedThreadId}
                  collapsedThreadIds={collapsedThreadIds}
                  collapsedEnvironmentIds={collapsedEnvironmentIds}
                  onProjectSelect={onProjectSelect}
                  onToggleThreadCollapsed={onToggleThreadCollapsed}
                  onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
                />
              </SpaceSidebarSection>
            </ThreadListVisibilityGroupScope>
          );
        }}
      </ReorderableSidebarSectionOrderList>
      <ThreadListMore />
    </ThreadListVisibility>
  );
}

function SpaceSidebarSection({
  space,
  sectionId,
  onOpen,
  onNewThread,
  isCollapsed,
  onToggleCollapsed,
  activity,
  threads,
  selected: leadSelected,
  consumeClickSuppression,
  children,
}: {
  space: StudioSpace;
  sectionId: SidebarSectionId;
  onOpen: () => void;
  onNewThread: () => void;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  activity: ReturnType<typeof getCollapsedChildActivity>;
  threads: readonly SidebarThread[];
  /** The Space's lead is open: the Space itself is. */
  selected: boolean;
  consumeClickSuppression?: Parameters<typeof SortableSidebarSection>[0]["consumeClickSuppression"];
  children: ReactNode;
}) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const pathname = usePathname();
  const selected = leadSelected || pathname === spaceHref(space.id) || pathname.startsWith(`${spaceHref(space.id)}/`);
  return (
    <SortableSidebarSection
      id={sectionId}
      sectionId={sectionId}
      label={space.name}
      labelMark={<SpaceMark space={space} />}
      onLabelClick={onOpen}
      labelClickLabel={`Open ${space.name}`}
      labelSelected={selected}
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
          <DropdownMenuItem onSelect={onOpen}>
            <Icon name="ArrowUpRight" />
            Open Space
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onNewThread}>
            <Icon name="MessageSquarePlus" />
            New thread
          </DropdownMenuItem>
          <ThreadListVisibilityMenuItems />
        </SidebarHeaderControls>
      )}
      collapsedActivity={activity}
      collapsedThreads={threads}
      collapseControl={{ isCollapsed, onToggleCollapsed }}
      consumeClickSuppression={consumeClickSuppression}
    >
      {children}
    </SortableSidebarSection>
  );
}
