// "Finish conversation" in every thread menu of a conversation that isn't
// Main and isn't finished: the Bot sidebar row's right-click menu and the
// conversation header's ··· menu (a thread action with placement "menu",
// which BB shows in both). It reads "Finishing…" while the conversation
// writes its summary (src/bot-finish.ts), and is off while it works.
import type { PluginThreadActionRegistration } from "@get-bb/plugin-sdk/app";
import { useCallback } from "react";
import type { BotThreadInfo } from "../../bot-threads-contract";
import { useCall } from "../live";
import { useThreadLookup } from "../thread-header";
import { canFinish } from "./finish";

const BUSY = new Set(["starting", "active", "stopping", "pending", "provisioning"]);

interface FinishData {
  infos: ReadonlyMap<string, BotThreadInfo | null>;
  finish(threadId: string): Promise<void>;
}

/** "Finish conversation" in the thread menus of a conversation. */
export const finishThreadAction: PluginThreadActionRegistration<FinishData> = {
  id: "finish-conversation",
  title: "Finish conversation",
  icon: "CircleCheck",
  group: "studio",
  order: 10,
  useData: ({ threadIds }) => {
    const call = useCall();
    const load = useCallback(async (threadId: string) => (await call("bot_thread_info", { threadId })).info ?? null, [call]);
    const infos = useThreadLookup(threadIds, load, { pollMs: 30_000 });
    const finish = useCallback(async (threadId: string) => { await call("bot_finish", { threadId }); }, [call]);
    return { infos, finish };
  },
  item: ({ thread, data }) => {
    const info = data.infos.get(thread.id);
    if (!canFinish(info)) return null;
    if (info!.finishing) return { label: "Finishing…", detail: "Writing its summary", icon: "CircleCheck", disabled: true, run: () => {} };
    const working = BUSY.has(thread.status ?? "");
    return {
      label: "Finish conversation",
      ...(working ? { detail: "Working" } : {}),
      icon: "CircleCheck",
      disabled: working,
      run: () => data.finish(thread.id),
    };
  },
};

