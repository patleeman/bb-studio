import { useEffect } from "react";
import { useLive } from "../../ui/live";
import { sharedLoop } from "../loop";
import { presenceSignal } from "../state";
import { BotPresence } from "./BotPresence";

export function HudPresence({ botId, working, size = 20 }: { botId: string | null; working: boolean; size?: number }) {
  const spaces = useLive("bot_spaces", {}, { pollMs: 60_000, enabled: !!botId });
  const bot = spaces.data?.bots.find((each) => each.id === botId) ?? null;
  useEffect(() => sharedLoop().runUnfocused(), []);
  if (!bot) return null;
  const state = presenceSignal({ needsYou: bot.needsYou, turn: working || !!bot.activity?.turn, workers: bot.activity?.workers ?? 0 });
  return <span data-testid="hud-presence" title={bot.name} className="flex items-center"><BotPresence bot={bot} size={size} state={state} /></span>;
}
