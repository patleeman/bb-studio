import { useRpc } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import type { rpcContract } from "../../contract";
import { useHostAppCommands, useHostLauncherItems, type HostAppCommand, type LauncherItem } from "../../kit/app/host-sdk";
import type { RunnableEntry } from "../commands";

export interface SpaceBot { id: string; name: string; mainThreadId: string | null }
export interface Spaces { bots: readonly SpaceBot[]; currentBotId: string | null }

const noItems: readonly LauncherItem[] = [];
const noCommands: readonly HostAppCommand[] = [];
export const useLauncherItems: () => readonly LauncherItem[] = useHostLauncherItems ?? (() => noItems);
export const useAppCommandList: () => readonly HostAppCommand[] = useHostAppCommands ?? (() => noCommands);

export function launcherEntry(item: LauncherItem): RunnableEntry {
  return { key: item.key, title: item.title, icon: item.icon, section: item.section, ...(item.keywords ? { keywords: item.keywords } : {}), ...(item.order !== undefined ? { order: item.order } : {}), run: item.run };
}

export function useSpaces(): Spaces {
  const rpc = useRpc<typeof rpcContract>();
  const [spaces, setSpaces] = useState<Spaces>({ bots: [], currentBotId: null });
  useEffect(() => {
    let live = true;
    void rpc.call("bot_spaces", {}).then((answer) => {
      if (live && answer) setSpaces({ bots: answer.bots.map((bot) => ({ id: bot.id, name: bot.name, mainThreadId: bot.mainThreadId })), currentBotId: answer.currentBotId });
    }, () => {});
    return () => { live = false; };
  }, [rpc]);
  return spaces;
}
