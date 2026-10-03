import { moduleApp } from "../../app";
import { definePluginApp, type PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { SidebarAnchors } from "@bb-studio/kit/app";
import { CompactViewportOverrideProvider } from "../components/ui/hooks/use-compact-viewport";
import { TooltipProvider } from "../components/ui/tooltip";
import { PreferencesSync } from "./app/preferences/PreferencesSync.js";
import { ProjectList } from "./app/list/ProjectList.js";

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

function registerSidebar(app: import("@get-bb/plugin-sdk/app").PluginAppBuilder) {
  app.slots.experimental_threadList({
    id: "thread-list",
    title: "Studio Sidebar",
    description:
      "Studio apps' sections above your threads: pinned threads, custom sections, projects, machines, and nested threads.",
    component: ThreadList,
  });
}
export function registerApp(host: import("@get-bb/plugin-sdk/app").PluginAppBuilder) { registerSidebar(moduleApp(host, "sidebar")); }
export default definePluginApp(registerSidebar);
