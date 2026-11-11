import { useState, type ReactNode } from "react";
import { useAtomValue } from "jotai";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  useCloseMobileSidebar,
  useIsSidebarFramed,
} from "@/components/ui/sidebar.js";
import {
  getBbDesktopInfo,
  MACOS_WINDOW_NO_DRAG_CLASS,
  shouldUseMacosDesktopChrome,
} from "@/lib/bb-desktop";
import { usePreferredReplacement } from "@/lib/plugin-replacement-preference";
import { usePluginSlots } from "@/lib/plugin-slots";
import { SidebarHistoryNavigationControls } from "./SidebarHistoryNavigationControls";
import { threadListProviderAtom } from "./threadListProvider";

export function useForkHidesSidebarHeader(): boolean {
  const { threadLists } = usePluginSlots();
  const preference = useAtomValue(threadListProviderAtom);
  const resolved = usePreferredReplacement(threadLists, preference);
  return (
    resolved.kind === "plugin" &&
    resolved.registration.experimental_hideSidebarHeader === true
  );
}

export interface ForkSidebarHeader {
  hidden: boolean;
  headerSlot: ReactNode | undefined;
  dropsRow: boolean;
}

export function useForkSidebarHeader({
  headerSlot,
  hasRail,
  usesDesktopChrome,
}: {
  headerSlot: ReactNode | undefined;
  hasRail: boolean;
  usesDesktopChrome: boolean;
}): ForkSidebarHeader {
  const hidden = useForkHidesSidebarHeader();
  if (!hidden) return { hidden, headerSlot, dropsRow: false };
  return {
    hidden,
    headerSlot: undefined,
    dropsRow: hasRail && !usesDesktopChrome,
  };
}

export function ForkMainHistoryControls({
  ownsWindowTopLeft,
}: {
  ownsWindowTopLeft: boolean;
}) {
  const hidden = useForkHidesSidebarHeader();
  if (!hidden || !ownsWindowTopLeft) return null;
  return <MainHistoryControls />;
}

function MainHistoryControls() {
  const isFramed = useIsSidebarFramed();
  const closeOnMobile = useCloseMobileSidebar();
  const [desktopInfo] = useState(getBbDesktopInfo);
  if (isFramed) return null;
  return (
    <SidebarHistoryNavigationControls
      onNavigate={closeOnMobile}
      className={cn(
        "pointer-events-auto -ml-1.5 shrink-0",
        shouldUseMacosDesktopChrome(desktopInfo) && MACOS_WINDOW_NO_DRAG_CLASS,
      )}
    />
  );
}
