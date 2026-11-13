import type { ExperimentalSidebarSectionPlacement } from "@get-bb/plugin-sdk/app";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { useSidebar } from "@/components/ui/sidebar.js";
import { useRouteState } from "@/hooks/useRouteState";
import { usePluginSlots } from "@/lib/plugin-slots";

export function PluginSidebarSections({
  onNavigate,
  placement = "list",
}: {
  onNavigate: () => void;
  placement?: ExperimentalSidebarSectionPlacement;
}) {
  const { sidebarSections } = usePluginSlots();
  const { projectId, threadId } = useRouteState();
  const { isCompactViewport } = useSidebar();
  return sidebarSections
    .filter((section) => (section.placement ?? "list") === placement)
    .map((section) => (
      <section
        key={`${section.pluginId}/${section.id}/${section.generation}`}
        aria-label={section.title}
        data-sidebar-plugin-section={`${section.pluginId}/${section.id}`}
        data-sidebar-plugin-section-placement={placement}
        className={placement === "footer" ? "shrink-0" : undefined}
      >
        <PluginSlotMount
          pluginId={section.pluginId}
          slotKind="sidebarSection"
          slotId={section.id}
        >
          <section.component
            activeThreadId={threadId ?? null}
            activeProjectId={projectId ?? null}
            isCompactViewport={isCompactViewport}
            onNavigate={onNavigate}
            placement={placement}
          />
        </PluginSlotMount>
      </section>
    ));
}
