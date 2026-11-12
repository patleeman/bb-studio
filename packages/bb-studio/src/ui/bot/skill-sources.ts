// Each Bot's own skills (the procedures Studio keeps per Bot) on BB's Skills
// page, through the fork's `slots.experimental_skillSource`: one source per
// Bot, named for it, so the page's Source filter shows one Bot's. A row opens
// the Bot's Controls at Skills, where Studio manages them.
//
// BB takes a source's label when the plugin registers, before Studio can ask
// its server, so the Bots are the ones this browser last saw (the sidebar
// remembers them); a new or renamed Bot shows after the next reload. With
// none seen yet, one source lists the primary Bot's.
import { useMemo } from "react";
import { member } from "../../kit/app/host-sdk";
import { openAppPath } from "../../kit/app/nav";
import { useLive } from "../live";

const KNOWN_KEY = "studio.skill-sources.bots";

export interface KnownBot { id: string; name: string }

/** Remembers the Bots for the next registration; called when the sidebar loads them. */
export function rememberBots(bots: readonly KnownBot[]): void {
  try {
    const next = JSON.stringify(bots.map(({ id, name }) => ({ id, name })));
    if (localStorage.getItem(KNOWN_KEY) !== next) localStorage.setItem(KNOWN_KEY, next);
  } catch { /* private mode */ }
}

export function knownBots(): KnownBot[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KNOWN_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((bot): bot is KnownBot => !!bot && typeof bot.id === "string" && typeof bot.name === "string" && !!bot.name.trim()) : [];
  } catch {
    return [];
  }
}

export const skillsPath = (botId: string) => `/plugins/studio/studio/bot/${encodeURIComponent(botId)}/controls#skills`;

interface SourceSkill { id: string; name: string; description?: string; onOpen(): void }

function useBotSkills(botId: string | null): readonly SourceSkill[] {
  const skills = useLive("bot_skills", botId ? { botId } : {}, { pollMs: 60_000 });
  return useMemo(() => (skills.data?.skills ?? []).filter((skill) => skill.state !== "archived").map((skill) => ({
    id: skill.name,
    name: skill.name,
    ...(skill.description ? { description: skill.description } : {}),
    onOpen: () => openAppPath(botId ? skillsPath(botId) : "/plugins/studio/studio/bot"),
  })), [skills.data, botId]);
}

/** Registers the sources; false on a BB without the slot. */
export function registerBotSkillSources(slots: object, bots: readonly KnownBot[] = knownBots()): boolean {
  const slot = member(slots, "experimental_skillSource");
  if (typeof slot !== "function") return false;
  const register = (registration: { id: string; label: string; useSkills(): readonly SourceSkill[] }) => (slot as (registration: unknown) => void).call(slots, registration);
  if (!bots.length) { register({ id: "bot", label: "Bot", useSkills: () => useBotSkills(null) }); return true; }
  for (const bot of bots) register({ id: `bot-${bot.id.replace(/[^\w-]/g, "_")}`, label: bot.name, useSkills: () => useBotSkills(bot.id) });
  return true;
}
