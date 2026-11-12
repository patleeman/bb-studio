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

export function ThemeLayer({ surface = "main" }: { surface?: "main" | "hud" }) {
  const hud = surface === "hud";
  const skip = !hud && inHostWindow();
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
    if (!hud) return;
    const created = new ThemeEngine({ ...defaultEngineDeps(), scenes: false });
    engine.current = created;
    const stop = watchEnvironment({ document, window, navigator }, (env) => created.setEnvironment(env));
    return () => { stop(); created.dispose(); engine.current = null; };
  }, [hud]);

  const listed = spaces.data?.bots;
  useEffect(() => { if (listed) settleSavedAppearances(listed); }, [listed]);

  const settings = JSON.stringify(appearance);
  useEffect(() => {
    engine.current?.show(bot && theme && appearance ? { key: `${bot.id}:${theme.id}`, theme, appearance } : null, mode);
  }, [bot?.id, theme, settings, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  return hud || skip ? null : <ThemeGpuBridge />;
}

export function HudTheme() {
  return <ThemeLayer surface="hud" />;
}
