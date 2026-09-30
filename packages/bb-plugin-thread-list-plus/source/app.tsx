import {
  definePluginApp,
  type PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import { SidebarAnchors } from "@bb-studio/kit/app";
import { CompactViewportOverrideProvider } from "@/components/ui/hooks/use-compact-viewport";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PreferencesSync } from "./app/preferences/PreferencesSync.js";
import { ProjectList } from "./app/list/ProjectList.js";
import { useSidebarThreadReveal } from "./app/list/useSidebarThreadReveal.js";

function ThreadList({
  activeThreadId,
  isCompactViewport,
  onNavigate,
}: PluginThreadListProps) {
  useSidebarThreadReveal();
  return (
    <CompactViewportOverrideProvider isCompactViewport={isCompactViewport}>
      <TooltipProvider>
        <PreferencesSync />
        {/* Studio apps' sections, above the threads and in the same scroll area. */}
        <SidebarAnchors onNavigate={onNavigate} />
        <ProjectList
          activeThreadId={activeThreadId}
          onProjectSelect={onNavigate}
        />
      </TooltipProvider>
    </CompactViewportOverrideProvider>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_threadList({
    id: "thread-list",
    title: "Studio Sidebar",
    description:
      "Studio apps' sections above your threads: pinned threads, custom sections, projects, machines, and nested threads.",
    component: ThreadList,
  });
});
