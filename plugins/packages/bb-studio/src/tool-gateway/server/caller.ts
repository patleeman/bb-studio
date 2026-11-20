// Who may change Tool Gateway. Only BB Studio's own app window on this Mac:
// the fork marks such a plugin RPC call `experimental_caller.studioAppWindow`
// (desktop: apps/server/src/services/plugins/fork-app-window-caller.ts). The
// CLI, agents, other plugins, the phone and browsers never get the flag, and
// stock bb never sets it, so there nothing can be approved.
import { experimental_PluginRpcRefusal } from "@get-bb/plugin-sdk";
import { APP_WINDOW_ONLY } from "../contract";

export function isAppWindow(context: unknown): boolean {
  const caller = (context as { experimental_caller?: { kind?: unknown; studioAppWindow?: unknown } } | null | undefined)?.experimental_caller;
  return caller?.kind === "client" && caller.studioAppWindow === true;
}

export function requireAppWindow(context: unknown): void {
  if (!isAppWindow(context)) throw new experimental_PluginRpcRefusal({ code: "forbidden", message: APP_WINDOW_ONLY });
}
