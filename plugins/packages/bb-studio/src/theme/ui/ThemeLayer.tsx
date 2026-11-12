import { useEffect, useRef } from "react";
import { inHostWindow } from "../../kit/app/windows";
import { shownBot } from "../../ui/conversations/BotSidebarPanel";
import { useAppMode } from "../../ui/conversations/app-mode";
import { useCurrentBot } from "../../ui/conversations/state";
import { useLive } from "../../ui/live";
import { defaultEngineDeps, ThemeEngine } from "../engine";
import { watchEnvironment } from "../guards";
import { ThemeGpuBridge } from "./GpuBridge";
import { settleSavedAppearances, shownAppearance, useAppearanceDraft, useThemeRegistry } from "./state";

export function ThemeLayer({ surface = "main" }: { surface?: "main" | "window" }) {
  const own = surface === "window";
  const skip = !own && inHostWindow();
  const spaces = useLive("bot_spaces", {}, { pollMs: 60_000, enabled: !skip });
  const chosen = useCurrentBot();
  const draft = useAppearanceDraft();
  const registry = useThemeRegistry();
  const mode = useAppMode();
  const engine = useRef<ThemeEngine | null>(null);
  const bot = shownBot(spaces.data?.bots ?? [], chosen, spaces.data?.currentBotId ?? null);
  const appearance = shownAppearance(bot, draft);
  const theme = appearance ? registry.get(appearance.themeId) : null;

  useEffect(() => {
    if (!own) return;
    const created = new ThemeEngine({ ...defaultEngineDeps(), scenes: false });
    engine.current = created;
    const stop = watchEnvironment({ document, window, navigator }, (env) => created.setEnvironment(env));
    return () => { stop(); created.dispose(); engine.current = null; };
  }, [own]);

  const listed = spaces.data?.bots;
  useEffect(() => { if (listed) settleSavedAppearances(listed); }, [listed]);

  const settings = JSON.stringify(appearance);
  useEffect(() => {
    engine.current?.show(bot && theme && appearance ? { key: `${bot.id}:${theme.id}`, theme, appearance } : null, mode);
  }, [bot?.id, theme, settings, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  return own || skip ? null : <ThemeGpuBridge />;
}

export function WindowTheme() {
  return <ThemeLayer surface="window" />;
}
