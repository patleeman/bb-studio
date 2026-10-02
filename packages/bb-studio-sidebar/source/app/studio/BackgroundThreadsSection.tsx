import { useEffect, useMemo } from "react";
import { useAtom, useAtomValue } from "jotai";
import type { SidebarThread } from "../model/sidebar-thread.js";
import type { ThreadComparator } from "../model/project-thread-groups.js";
import { getCollapsedChildActivity } from "../model/thread-activity.js";
import { useSidebarThreadDraftIds } from "@get-bb/plugin-sdk/app";
import { TopLevelSidebarSection } from "../list/TopLevelSidebarSection.js";
import { ProjectThreadTree } from "../list/ProjectRow.js";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent } from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { sidebarBackgroundThreadsAtom, sidebarBackgroundCollapsedAtom } from "../preferences/atoms.js";
import { backgroundUpdates } from "./background-threads.js";
import { BackgroundThreadsMenuItems } from "./BackgroundThreadsMenuItems.js";

export function BackgroundThreadsSection({ threads, selectedThreadId, compareThreads, collapsedThreadIds, collapsedEnvironmentIds, onProjectSelect, onToggleThreadCollapsed, onToggleEnvironmentCollapsed }: {
  threads: SidebarThread[];
  selectedThreadId?: string;
  compareThreads: ThreadComparator;
  collapsedThreadIds: Set<string>;
  collapsedEnvironmentIds: Set<string>;
  onProjectSelect?: () => void;
  onToggleThreadCollapsed: (id: string) => void;
  onToggleEnvironmentCollapsed: (id: string) => void;
}) {
  const mode = useAtomValue(sidebarBackgroundThreadsAtom);
  const [collapsed, setCollapsed] = useAtom(sidebarBackgroundCollapsedAtom);
  const drafts = useSidebarThreadDraftIds();
  const selected = threads.some((thread) => thread.id === selectedThreadId);
  useEffect(() => { if (selected) setCollapsed(false); }, [selected, selectedThreadId, setCollapsed]);
  const visible = useMemo(() => mode === "updates" ? backgroundUpdates(threads, selectedThreadId) : threads, [mode, threads, selectedThreadId]);
  if (mode === "all" || mode === "hidden" || visible.length === 0) return null;
  return <div className="mt-4" data-sidebar-background-threads="">
    <TopLevelSidebarSection label="Background" sectionId="background" collapsedActivity={getCollapsedChildActivity(threads, drafts)} collapsedThreads={threads}
      collapseControl={{ isCollapsed: collapsed, onToggleCollapsed: () => setCollapsed(!collapsed) }}
      actionsMobileAlways actions={<DropdownMenu>
        <DropdownMenuTrigger asChild><button type="button" aria-label="Background actions" className="inline-flex size-7 items-center justify-center rounded-md outline-none focus-visible:ring-2"><Icon name="MoreHorizontal" className="size-4" /></button></DropdownMenuTrigger>
        <DropdownMenuContent><BackgroundThreadsMenuItems /></DropdownMenuContent>
      </DropdownMenu>}>
      <ProjectThreadTree threadListState={{ status: "ready", threads: visible }} variant="section" compareThreads={compareThreads} selectedThreadId={selectedThreadId}
        collapsedThreadIds={collapsedThreadIds} collapsedEnvironmentIds={collapsedEnvironmentIds} onProjectSelect={onProjectSelect}
        onToggleThreadCollapsed={onToggleThreadCollapsed} onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed} />
    </TopLevelSidebarSection>
  </div>;
}
