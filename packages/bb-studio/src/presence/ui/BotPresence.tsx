import { useMemo } from "react";
import { useSceneSignals } from "../../theme/signals";
import { shownAppearance, useAppearanceDraft, useThemeRegistry } from "../../theme/ui/state";
import type { Appearance } from "../../theme/appearance";
import { useAppMode } from "../../ui/conversations/app-mode";
import { STATE_NAMES, type PresenceStateName } from "../forms";
import { presenceLook } from "../look";
import { isBuiltinPresence, type Presence } from "../schema";
import { botFacts, presenceSignal, type PresenceSignal } from "../state";
import { PresenceView } from "./PresenceView";
import { shownPresence, useCustomPresences, usePresenceVersion } from "./state";

export interface PresenceBot {
  id: string;
  primary?: boolean;
  presence?: Presence;
  appearance?: Appearance | null;
  needsYou?: boolean;
  activity?: { turn: boolean; workers: number };
}

export function usePresenceLook(bot: PresenceBot, presence: Presence) {
  const overrides = useAppearanceDraft();
  const registry = useThemeRegistry();
  const mode = useAppMode();
  const appearance = shownAppearance(bot, overrides);
  const theme = appearance ? registry.get(appearance.themeId) : null;
  const color = JSON.stringify(presence.color);
  return useMemo(() => presenceLook(presence, theme, mode), [color, theme, mode]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function useBotSignal(bot: PresenceBot): PresenceSignal {
  const signals = useSceneSignals();
  return presenceSignal(botFacts(bot, signals));
}

export function BotPresence({ bot, size, state, still = false, className }: { bot: PresenceBot; size: number; state?: { state: PresenceStateName; workers: number }; still?: boolean; className?: string }) {
  usePresenceVersion();
  const presence = shownPresence(bot);
  const customs = useCustomPresences(!isBuiltinPresence(presence.form));
  const look = usePresenceLook(bot, presence);
  const live = useBotSignal(bot);
  const signal = state ?? live;
  return (
    <span data-testid="bot-presence" data-form={presence.form} data-state={signal.state} data-workers={signal.workers} role="img" aria-label={STATE_NAMES[signal.state]}
      className={`inline-flex shrink-0 ${className ?? ""}`} style={{ width: size, height: size }}>
      <PresenceView form={presence.form} custom={customs.get(presence.form) ?? null} palette={look.palette} light={look.light} state={signal.state} workers={signal.workers} motion={presence.motion} size={size} still={still} />
    </span>
  );
}
