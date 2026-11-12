import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { BotThreadInfo } from "../../bot-threads-contract";
import type { rpcContract } from "../../contract";
import { useHudHotkey } from "../../hud/hotkey";
import { canPopOut, popOutToHud, useCanPopOutToHud } from "../../hud/ui/pop-out";
import { routeContainer } from "../../kit/app/container";
import type { CommandPaletteProps } from "../../kit/app/host-sdk";
import { openAppPath } from "../../kit/app/nav";
import { hasHostWindows, useHostWindows } from "../../kit/app/windows";
import { STUDIO_PLUGIN_ID } from "../../kit/contract";
import { errorMessage } from "../../kit/format";
import { useStudioSettings } from "../../settings/ui/use-settings";
import { requestVoiceSection, STUDIO_SETTINGS_PATH } from "../../settings/ui/voice-anchor";
import { landingThread } from "../../ui/conversations/model";
import { currentBot, lastConversation, setCurrentBot, showBotNumber } from "../../ui/conversations/state";
import { useOpenLink } from "../../links/open";
import { linkFor } from "../../links/router";
import { appCommandEntries, studioCommandEntries } from "../commands";
import { applyThemeToShownBot, cycleTheme, shownBotThemeChoices, THEME_NEXT_COMMAND, THEME_PREVIOUS_COMMAND } from "../../theme/ui/quick";
import { isHudItem, setLauncherRuntime } from "../items";
import type { LauncherRow } from "../rank";
import { Omnibar, type OmnibarRun } from "./Omnibar";
import { launcherEntry, useAppCommandList, useLauncherItems, useSpaces } from "./omnibar-data";

type Rpc = { call(method: string, input: unknown): Promise<unknown> };

const MAIN_WINDOW_APP = "studio";

const THEME_NEXT_ID = `plugin:${STUDIO_PLUGIN_ID}/${THEME_NEXT_COMMAND}`;
const THEME_PREVIOUS_ID = `plugin:${STUDIO_PLUGIN_ID}/${THEME_PREVIOUS_COMMAND}`;

const later = (run: () => void | Promise<void>) => () => { void Promise.resolve().then(run).catch((cause: unknown) => { toast.error(errorMessage(cause)); }); };

export function StudioCommandPalette({ initialMode, close, experimental_onEscape }: CommandPaletteProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const openLink = useOpenLink();
  const windows = useHostWindows();
  const { values, set } = useStudioSettings();
  const hudOn = values?.hudEnabled === true;
  const hudHotkey = useHudHotkey(values?.hudHotkey ?? "").inUse;
  const items = useLauncherItems();
  const commands = useAppCommandList();
  const spaces = useSpaces();
  const popOutAllowed = useCanPopOutToHud();
  const [threadId] = useState(() => { const container = routeContainer(); return container?.kind === "thread" ? container.threadId : null; });
  const [info, setInfo] = useState<BotThreadInfo | null | undefined>(undefined);
  const [themes] = useState(shownBotThemeChoices);

  useEffect(() => { setLauncherRuntime({ rpc: rpc as unknown as Rpc, windows, hudHotkey }); }, [rpc, windows, hudHotkey]);

  useEffect(() => {
    if (!threadId) return;
    let live = true;
    void rpc.call("bot_thread_info", { threadId }).then((answer) => { if (live) setInfo(answer?.info ?? null); }, () => { if (live) setInfo(null); });
    return () => { live = false; };
  }, [rpc, threadId]);

  const shownBotId = currentBot() ?? spaces.currentBotId ?? spaces.bots[0]?.id ?? null;
  const askBot = info ? { id: info.botId, name: info.botName } : spaces.bots.find((bot) => bot.id === shownBotId) ?? null;

  const entries = useMemo(() => {
    const own = [
      ...items.filter((item) => !(item.pluginId === STUDIO_PLUGIN_ID && item.id === MAIN_WINDOW_APP) && (hudOn || !isHudItem(item))).map((item) => ({ ...launcherEntry(item), run: later(item.run) })),
      ...studioCommandEntries({
        themes, themeShortcuts: { next: commands.find((command) => command.id === THEME_NEXT_ID)?.shortcut, previous: commands.find((command) => command.id === THEME_PREVIOUS_ID)?.shortcut },
        bots: spaces.bots, currentBotId: shownBotId, popOutThreadId: threadId && popOutAllowed && canPopOut(info) ? threadId : null, settings: values, windows: hasHostWindows,
      }, {
        switchBot: (botId) => {
          const index = spaces.bots.findIndex((bot) => bot.id === botId) + 1;
          if (showBotNumber(index)) return;
          setCurrentBot(botId);
          const target = landingThread(spaces.bots.find((bot) => bot.id === botId), lastConversation(botId), null);
          if (target) navigate.toThread(target);
        },
        popOut: (id) => popOutToHud(id),
        openSettings: (group) => { if (group === "voice") requestVoiceSection(); openAppPath(STUDIO_SETTINGS_PATH); },
        setSetting: (key, value) => set({ [key]: value }),
        applyTheme: async (themeId) => { await applyThemeToShownBot(themeId); },
        cycleTheme: async (step) => { await cycleTheme(step); },
      }).map((entry) => ({ ...entry, run: later(entry.run) })),
    ];
    return [...own, ...appCommandEntries(themes.length ? commands.filter((command) => command.id !== THEME_NEXT_ID && command.id !== THEME_PREVIOUS_ID) : commands, own)];
  }, [items, hudOn, spaces, shownBotId, threadId, popOutAllowed, info, values, set, navigate, commands, themes]);
  const runs = useMemo(() => new Map(entries.map((entry) => [entry.key, entry])), [entries]);

  const ask = async (text: string, fresh: boolean): Promise<string> => {
    if (fresh) return (await rpc.call("bot_ask", { text, to: { kind: "new", botId: askBot?.id ?? null } })).threadId;
    const space = spaces.bots.find((bot) => bot.id === askBot?.id);
    const target = threadId ?? landingThread(space, space ? lastConversation(space.id) : null, null);
    if (!target) throw new Error("Make your Bot first.");
    return (await rpc.call("bot_ask", { text, to: { kind: "thread", threadId: target } })).threadId;
  };

  const run = async (row: LauncherRow, how: OmnibarRun) => {
    if (row.type === "ask") {
      const target = await ask(row.text, how.shift);
      close(target === threadId ? undefined : () => navigate.toThread(target));
    } else if (row.type === "url") {
      close(() => { void openLink(row.url, { source: "palette", modifiers: { meta: how.alternate, shift: how.shift } }); });
    } else if (row.type === "document") {
      const { document } = row;
      close(() => { void openLink(document.ref ? linkFor(document.ref) : document.path, { source: "palette", title: document.title, modifiers: { meta: how.alternate, shift: how.shift } }); });
    } else {
      const entry = runs.get(row.key);
      if (!entry) return;
      if (entry.key.startsWith("bb:")) void entry.run();
      else close(() => { void entry.run(); });
    }
  };

  return <Omnibar host="palette" mode={initialMode} entries={entries} botName={askBot?.name ?? null} botId={askBot?.id ?? null} threadId={threadId} onRun={run} onClose={() => close()} onEscape={experimental_onEscape} />;
}
