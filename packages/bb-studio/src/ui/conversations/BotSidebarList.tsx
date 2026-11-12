// Studio's sidebar: the thread list `studio/everything`, the current Bot's
// conversations and workers (BotSidebarPanel).
import type { PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { useMarkUnifiedSidebarShown } from "../unified-sidebar-shown";
import { BotSidebarPanel } from "./BotSidebarPanel";

export function BotSidebarList(props: Pick<PluginThreadListProps, "onNavigate" | "activeThreadId">) {
  useMarkUnifiedSidebarShown();
  return <BotSidebarPanel {...props} />;
}
