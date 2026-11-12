import type { PresenceStateName } from "./forms";

export interface PresenceSignal { state: PresenceStateName; workers: number }
export interface BotFacts { needsYou: boolean; turn: boolean; workers: number }

export const IDLE: PresenceSignal = { state: "idle", workers: 0 };

export function presenceSignal(facts: BotFacts): PresenceSignal {
  const workers = Math.max(0, Math.round(facts.workers));
  if (facts.needsYou) return { state: "needs", workers };
  if (workers > 0) return { state: "working", workers };
  if (facts.turn) return { state: "thinking", workers: 0 };
  return IDLE;
}

export interface LiveSignals {
  botId: string | null;
  workers: readonly { status: string }[];
  conversations: readonly { running: boolean; needsYou: boolean }[];
}

export interface SpaceFacts { id: string; needsYou?: boolean; activity?: { turn: boolean; workers: number } }

export function botFacts(bot: SpaceFacts, live: LiveSignals | null): BotFacts {
  if (live && live.botId === bot.id) {
    return {
      needsYou: !!bot.needsYou || live.conversations.some((row) => row.needsYou) || live.workers.some((row) => row.status === "needs-you"),
      turn: live.conversations.some((row) => row.running),
      workers: live.workers.filter((row) => row.status === "running").length,
    };
  }
  return { needsYou: !!bot.needsYou, turn: !!bot.activity?.turn, workers: bot.activity?.workers ?? 0 };
}
