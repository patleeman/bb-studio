import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { useSidebar } from "@/components/ui/sidebar.js";
import { useRouteState } from "@/hooks/useRouteState";
import { usePluginSlots } from "@/lib/plugin-slots";

export function PluginSidebarSections({
  onNavigate,
}: {
  onNavigate: () => void;
}) {
  const { sidebarSections } = usePluginSlots();
  const { projectId, threadId } = useRouteState();
  const { isCompactViewport } = useSidebar();
  return sidebarSections.map((section) => (
    <section
      key={`${section.pluginId}/${section.id}/${section.generation}`}
      aria-label={section.title}
      data-sidebar-plugin-section={`${section.pluginId}/${section.id}`}
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
        />
      </PluginSlotMount>
    </section>
  ));
}
