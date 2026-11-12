import { useEffect, useRef, useSyncExternalStore } from "react";
import { registerAppBackdrop, type HostAppAppearance, type HostAppSurfaceStyle } from "../kit/app/host-sdk";
import { shownBot } from "../ui/conversations/BotSidebarPanel";
import { useAppMode } from "../ui/conversations/app-mode";
import { useCurrentBot } from "../ui/conversations/state";
import { useLive } from "../ui/live";
import { defaultEngineDeps, ThemeEngine, type ShownTheme } from "./engine";
import { watchEnvironment } from "./guards";
import type { ResolvedLook } from "./look";
import type { Surface } from "./schema";
import { useSceneSignals } from "./signals";
import { CARD_GAP, CARD_RADIUS, lookTokens } from "./tokens";
import { shownAppearance, useAppearanceDraft, useThemeRegistry } from "./ui/state";

/** Menus, popovers, tooltips, dialogs and the palette over a scene: the `hud` glass with a lighter blur. */
export const POPOVER_FILTER = "blur(12px) saturate(var(--studio-glass-saturate))";
const blurOf = (surface: Surface) => `blur(var(--studio-blur-${surface})) saturate(var(--studio-glass-saturate))`;

export function studioAppearance(look: ResolvedLook | null): HostAppAppearance | null {
  if (!look) return null;
  const glass = (surface: Surface): HostAppSurfaceStyle => ({
    background: `var(--studio-glass-${surface})`,
    ...(look.blur[surface] > 0 ? { backdropFilter: blurOf(surface) } : {}),
  });
  return {
    ...(look.fixedMode ? { mode: look.mode } : {}),
    tokens: lookTokens(look),
    surfaces: {
      sidebar: glass("sidebar"),
      main: glass(look.glassy ? "transcript" : "main"),
      header: glass("transcript"),
      composer: glass("composer"),
      secondaryPanel: glass("composer"),
      ...(look.glassy ? { popover: { background: "var(--studio-glass-hud)", backdropFilter: POPOVER_FILTER } } : {}),
    },
    ...(look.glassy ? { layout: { cards: { gap: CARD_GAP, radius: CARD_RADIUS } } } : {}),
  };
}

let current: HostAppAppearance | null = null;
const listeners = new Set<() => void>();

function publishLook(look: ResolvedLook | null): void {
  const next = studioAppearance(look);
  if (!next && !current) return;
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useStudioAppearance(): HostAppAppearance | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}

function useShownTheme(): ShownTheme | null {
  const spaces = useLive("bot_spaces", {}, { pollMs: 60_000 });
  const chosen = useCurrentBot();
  const draft = useAppearanceDraft();
  const registry = useThemeRegistry();
  const bot = shownBot(spaces.data?.bots ?? [], chosen, spaces.data?.currentBotId ?? null);
  const appearance = shownAppearance(bot, draft);
  const theme = appearance ? registry.get(appearance.themeId) : null;
  return bot && theme && appearance ? { key: `${bot.id}:${theme.id}`, theme, appearance } : null;
}

export function StudioScene() {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<ThemeEngine | null>(null);
  const shown = useShownTheme();
  const mode = useAppMode();
  const signals = useSceneSignals();
  const latest = useRef(shown);
  latest.current = shown;

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const doc = element.ownerDocument;
    const view = doc.defaultView ?? window;
    const created = new ThemeEngine({ ...defaultEngineDeps(doc), host: element, publish: publishLook });
    engine.current = created;
    const stop = watchEnvironment({ document: doc, window: view, navigator: view.navigator }, (env) => created.setEnvironment(env));
    return () => { stop(); created.dispose(); engine.current = null; };
  }, []);

  const key = shown?.key ?? null;
  const theme = shown?.theme ?? null;
  const settings = JSON.stringify(shown?.appearance ?? null);
  useEffect(() => { engine.current?.show(latest.current, mode); }, [key, theme, settings, mode]);
  useEffect(() => { engine.current?.setSignals(signals); }, [signals]);

  return <div ref={host} data-studio-scene="" style={{ background: "var(--background)" }} />;
}

export function registerThemeBackdrop(slots: object): boolean {
  return registerAppBackdrop(slots, { id: "theme", component: StudioScene, useAppearance: useStudioAppearance });
}
