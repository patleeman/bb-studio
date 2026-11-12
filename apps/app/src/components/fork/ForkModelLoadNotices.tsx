import type { ReactNode } from "react";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { usePluginSlots } from "@/lib/plugin-slots";

interface ForkModelLoadNoticeArgs {
  providerLabel: string;
  error: { code: string; detail?: string | null };
}

function ForkModelLoadNotices({
  providerLabel,
  error,
}: ForkModelLoadNoticeArgs) {
  const notices = [...(usePluginSlots().modelLoadNotices ?? [])].sort(
    (a, b) => a.pluginId.localeCompare(b.pluginId) || a.id.localeCompare(b.id),
  );
  if (notices.length === 0) return null;
  return (
    <>
      {notices.map((notice) => (
        <PluginSlotMount
          key={`${notice.pluginId}/${notice.id}/${notice.generation}`}
          pluginId={notice.pluginId}
          slotKind="modelLoadNotice"
          slotId={notice.id}
          crashFallback={null}
        >
          <span
            data-fork-model-load-notice={`${notice.pluginId}/${notice.id}`}
            className="block"
          >
            <notice.component
              providerLabel={providerLabel}
              code={error.code}
              detail={error.detail ?? null}
            />
          </span>
        </PluginSlotMount>
      ))}
    </>
  );
}

export function forkModelLoadNotice(args: ForkModelLoadNoticeArgs): ReactNode {
  return <ForkModelLoadNotices {...args} />;
}
