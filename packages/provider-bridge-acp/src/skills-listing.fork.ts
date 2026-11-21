// The skills list an ACP agent reads in its first prompt, shorter: each skill
// root's folder is named once, and each skill is a name and its description.
// Upstream repeats the full SKILL.md path (a 64-character hash folder) on
// every line, about half the list's tokens.
import path from "node:path";

interface SkillRoot {
  skillDirectoryRootPath: string;
  skills: readonly { name: string; description: string }[];
}

export function buildForkAcpSkillsInstructions(
  skillRoots: readonly SkillRoot[] | undefined,
  sanitize: (description: string) => string,
): string | undefined {
  const sections = (skillRoots ?? [])
    .filter((root) => root.skills.length > 0)
    .map((root) => [
      `Skills in ${path.join(root.skillDirectoryRootPath, "<name>", "SKILL.md")}:`,
      ...root.skills.map((skill) => `- ${skill.name}: ${sanitize(skill.description)}`),
    ].join("\n"));
  if (sections.length === 0) return undefined;
  return [
    "bb skills are reusable instruction folders. When the current task matches a listed skill description, read that skill's SKILL.md (its folder's path, with <name> replaced by the skill's name) before proceeding; you may read supporting files in the same skill directory that SKILL.md references. If a path does not exist, the list is stale and should be ignored.",
    "",
    ...sections.flatMap((section, index) => (index === 0 ? [section] : ["", section])),
  ].join("\n");
}
