// The launcher's window (src/launcher/shared.ts): the omnibar (Omnibar.tsx)
// in a window of its own. BB shows it frameless and opaque in the middle of
// the screen and closes it when it loses focus, so every summon is a fresh
// page. What it differs in from Cmd+K: everything opens in BB's main window
// (openInMain), BB's commands run there too (window.runInMain), and Ask goes
// to the primary Bot's chat, with the reply in the HUD.
import { useRpc } from "@get-bb/plugin-sdk/app";
import { useEffect, useMemo, useState } from "react";
import type { rpcContract } from "../../contract";
import type { hudContract } from "../../hud/contract";
import { useHudHotkey } from "../../hud/hotkey";
import { useHostWindows } from "../../kit/app/windows";
import { useStudioSettings } from "../../settings/ui/use-settings";
import { STUDIO_SETTINGS_PATH } from "../../settings/ui/voice-anchor";
import { landingThread } from "../../ui/conversations/model";
import { lastConversation } from "../../ui/conversations/state";
import { appCommandEntries, studioCommandEntries } from "../commands";
import { isHudItem, openHud, openInMain, setLauncherRuntime } from "../items";
import { LinksBridge, useOpenLink } from "../../links/open";
import { linkFor } from "../../links/router";
import type { LauncherRow } from "../rank";
import { LAUNCHER_WINDOW_ID, threadPath } from "../shared";
import { Omnibar, type OmnibarRun } from "./Omnibar";
import { launcherEntry, useAppCommandList, useLauncherItems, useSpaces } from "./omnibar-data";

type Rpc = { call(method: string, input: unknown): Promise<unknown> };
type HudBot = { id: string; name: string; threadId: string | null };

export function LauncherWindow() {
  const windows = useHostWindows();
  const rpc = useRpc<typeof rpcContract>();
  const hud = useRpc<typeof hudContract>();
  const { values, set } = useStudioSettings();
  const hudOn = values?.hudEnabled === true;
  const hudHotkey = useHudHotkey(values?.hudHotkey ?? "").inUse;
  const items = useLauncherItems();
  const commands = useAppCommandList();
  const spaces = useSpaces();
  const [bot, setBot] = useState<HudBot | null>(null);
  const openLink = useOpenLink();

  useEffect(() => {
    setLauncherRuntime({ rpc: rpc as unknown as Rpc, windows, hudHotkey });
    return () => setLauncherRuntime(null);
  }, [rpc, windows, hudHotkey]);

  useEffect(() => {
    let live = true;
    void hud.call("hud.get", null).then((answer) => { if (live) setBot(answer?.bot ?? null); }, () => {});
    return () => { live = false; };
  }, [hud]);

  const entries = useMemo(() => {
    const own = [
      ...items.filter((item) => hudOn || !isHudItem(item)).map(launcherEntry),
      ...studioCommandEntries({ bots: spaces.bots, currentBotId: spaces.currentBotId, popOutThreadId: null, settings: values, windows: true }, {
        switchBot: async (botId) => {
          const target = landingThread(spaces.bots.find((each) => each.id === botId), lastConversation(botId), null);
          if (!target) throw new Error("That Bot has no conversation yet.");
          await rpc.call("bot_focus", { botId });
          await openInMain(threadPath(target));
        },
        popOut: () => {},
        openSettings: () => openInMain(STUDIO_SETTINGS_PATH),
        setSetting: (key, value) => set({ [key]: value }),
      }),
    ];
    const relayed = appCommandEntries(commands, own, async (command) => { await hud.call("window.runInMain", { kind: "command", commandId: command.id }); });
    return [...own, ...relayed];
  }, [items, hudOn, spaces, values, set, rpc, hud, commands]);
  const runs = useMemo(() => new Map(entries.map((entry) => [entry.key, entry.run])), [entries]);

  const close = () => { void windows.close(LAUNCHER_WINDOW_ID).then((closed) => { if (!closed && !windows.native) window.close(); }, () => {}); };
  const run = async (row: LauncherRow, how: OmnibarRun) => {
    if (row.type === "ask") {
      const { threadId } = how.shift
        ? await rpc.call("bot_ask", { text: row.text, to: { kind: "new", botId: bot?.id ?? null } })
        : await hud.call("hud.send", { text: row.text });
      if (hudOn) await openHud(threadId); else await openInMain(threadPath(threadId));
    } else if (row.type === "url") {
      await openLink(row.url, { source: "launcher", modifiers: { meta: how.alternate, shift: how.shift } });
    } else if (row.type === "document") {
      await openLink(row.document.ref ? linkFor(row.document.ref) : row.document.path, { source: "launcher", title: row.document.title, modifiers: { meta: how.alternate, shift: how.shift } });
    } else {
      await runs.get(row.key)?.();
    }
    close();
  };

  return <><LinksBridge /><Omnibar host="launcher" mode="commands" entries={entries} botName={bot?.threadId ? bot.name : null} botId={bot?.id ?? null} threadId={null} onRun={run} onClose={close} /></>;
}
