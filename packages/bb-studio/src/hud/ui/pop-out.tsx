// "Pop out to HUD" on a conversation, in BB's main window: a small muted
// icon after its title in the header (Studio's `experimental_threadHeader`
// decoration, src/ui/conversations/ReadOnlyComposer.tsx) and a row in its
// thread menus (the header's ··· and the sidebar row's, a thread action).
// Both open the HUD on that conversation (HudBridge's showHud); the HUD's
// "Pop back in" returns it here. Only on a BB with plugin windows, with the
// HUD on in settings, and not on a worker (its box is the Bot's, not a chat).
import type { PluginThreadActionRegistration } from "@get-bb/plugin-sdk/app";
import { useCallback } from "react";
import type { BotThreadInfo } from "../../bot-threads-contract";
import { Icon } from "../../kit/ui/index";
import { hasHostWindows, inHostWindow } from "../../kit/app/windows";
import { useStudioSettings } from "../../settings/ui/use-settings";
import { useCall } from "../../ui/live";
import { useThreadLookup } from "../../ui/thread-header";
import { showHud } from "./HudBridge";
import { POP_OUT_LABEL } from "../shared";

export { POP_OUT_LABEL };

const POP_OUT_ICON = "AppWindow";

/** Whether this window can pop a conversation out: BB has plugin windows, this is the main window, and the HUD is on. */
export function useCanPopOutToHud(): boolean {
  const enabled = useStudioSettings().values?.hudEnabled === true;
  return hasHostWindows && !inHostWindow() && enabled;
}

/** Whether a thread gets "Pop out to HUD", by what Studio knows of it: any thread but a worker; undefined while that is loading. */
export function canPopOut(info: Pick<BotThreadInfo, "kind"> | null | undefined): boolean {
  return info !== undefined && info?.kind !== "worker";
}

export function popOutToHud(threadId: string): void {
  void showHud(threadId);
}

/** The header's icon. */
export function PopOutHudButton({ threadId }: { threadId: string }) {
  return (
    <button type="button" data-testid="hud-pop-out" aria-label={POP_OUT_LABEL} title={POP_OUT_LABEL} onClick={() => popOutToHud(threadId)}
      className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
      <Icon name={POP_OUT_ICON} className="size-3.5" />
    </button>
  );
}

interface PopOutData {
  enabled: boolean;
  infos: ReadonlyMap<string, BotThreadInfo | null>;
}

/** "Pop out to HUD" in a conversation's thread menus. */
export const popOutHudThreadAction: PluginThreadActionRegistration<PopOutData> = {
  id: "pop-out-hud",
  title: POP_OUT_LABEL,
  icon: POP_OUT_ICON,
  group: "studio",
  order: 5,
  useData: ({ threadIds }) => {
    const enabled = useCanPopOutToHud();
    const call = useCall();
    const load = useCallback(async (threadId: string) => (await call("bot_thread_info", { threadId })).info ?? null, [call]);
    const infos = useThreadLookup(threadIds, load, { enabled });
    return { enabled, infos };
  },
  item: ({ thread, data }) => {
    if (!data.enabled || !canPopOut(data.infos.has(thread.id) ? data.infos.get(thread.id) : undefined)) return null;
    return { label: POP_OUT_LABEL, icon: POP_OUT_ICON, run: () => popOutToHud(thread.id) };
  },
};
