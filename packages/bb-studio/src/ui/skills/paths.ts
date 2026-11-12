export const SKILLS_SUBPATH = "skills";
export const skillsPagePath = (botId: string | null) => `${SKILLS_SUBPATH}${botId ? `/${encodeURIComponent(botId)}` : ""}`;

export type SkillsFilter = "skills" | "archived" | "history";

export function skillsBotFromPath(path: string): string | null {
  const match = /^skills\/([^/?#]+)/.exec(path.replace(/^\/+/, ""));
  if (!match) return null;
  try { return decodeURIComponent(match[1]!); } catch { return null; }
}

export function matchesSkill(query: string, skill: { name: string; description: string }): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const text = `${skill.name.replace(/-/g, " ")} ${skill.name} ${skill.description}`.toLowerCase();
  return words.every((word) => text.includes(word));
}
