import type { ReactNode } from "react";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { isBareWindow } from "@/lib/fork-bare-window";
import { usePluginSlots } from "@/lib/plugin-slots";
import { ForkWorkbenchSurface } from "./ForkWorkbenchSurface";

function ForkThreadBanners({ threadId }: { threadId: string }) {
  const banners = [...(usePluginSlots().threadBanners ?? [])].sort(
    (a, b) => a.pluginId.localeCompare(b.pluginId) || a.id.localeCompare(b.id),
  );
  if (banners.length === 0) return null;
  return (
    <>
      {banners.map((banner) => (
        <PluginSlotMount
          key={`${banner.pluginId}/${banner.id}/${banner.generation}/${threadId}`}
          pluginId={banner.pluginId}
          slotKind="threadBanner"
          slotId={banner.id}
          instanceId={threadId}
          crashFallback={null}
        >
          <div
            data-fork-thread-banner={`${banner.pluginId}/${banner.id}`}
            className="min-w-0 shrink-0"
          >
            <banner.component threadId={threadId} />
          </div>
        </PluginSlotMount>
      ))}
    </>
  );
}

export function forkThreadBanner(threadId: string): ReactNode {
  if (isBareWindow()) return null;
  return (
    <>
      <ForkWorkbenchSurface key={threadId} threadId={threadId} />
      <ForkThreadBanners threadId={threadId} />
    </>
  );
}
