import { definePluginApp, type PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { Navigation } from "./app/navigation/Navigation.js";
import { SidebarAnchors } from "@bb-studio/kit/app";
import { CompactViewportOverrideProvider } from "@/components/ui/hooks/use-compact-viewport";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PreferencesSync } from "./app/preferences/PreferencesSync.js";
import { ProjectList } from "./app/list/ProjectList.js";
import { registerThreadAutomations } from "./app/studio/automations/register.js";

function ThreadList({
  activeThreadId,
  isCompactViewport,
  onNavigate,
}: PluginThreadListProps) {
  return (
    <CompactViewportOverrideProvider isCompactViewport={isCompactViewport}>
      <TooltipProvider>
        <PreferencesSync />
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
  // BB 0.46 has no sidebar navigation slot; there BB's own navigation stays.
  app.slots.experimental_sidebarNavigation?.({
    id: "navigation", title: "Studio Navigation",
    description: "BB navigation without the add-on rows Studio already opens.",
    component: Navigation,
  });
  app.slots.experimental_threadList({
    id: "thread-list",
    title: "Studio Sidebar",
    description:
      "Studio apps' sections above your threads: pinned threads, custom sections, projects, machines, and nested threads.",
    component: ThreadList,
  });
  registerThreadAutomations(app);
});
