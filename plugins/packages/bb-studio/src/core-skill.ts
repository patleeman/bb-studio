// Always-on skills (plan "BB Studio Memory & Skills Architecture"): a Bot's
// skills with `always_on` set go in full into the instructions of every
// conversation and worker of the Bot, where the core profile page went
// before. The default one is `core-profile`, with three sections:
//
// - `## Preferences`: one-line rules for working with the user (at most 25).
// - `## Right now`: temporary constraints true this month (at most 10).
// - `## Check-in`: the Bot's check-in list (its check-in reads it).
//
// The caps are advisory lint, like every skill note: a save is never
// blocked, and a skill over its budget is kept whole and flagged, never cut
// silently. No SDK import: the UI uses these too.

/** The default always-on skill's name. */
export const CORE_SKILL = "core-profile";
export const CORE_SKILL_DESCRIPTION = "Always on: how to work with the user, what is true right now, and the check-in list.";
/** The most characters of always-on skills, all together, that go into every prompt. */
export const ALWAYS_ON_CAP = 3000;
/** Bullets each capped section may hold. */
export const SECTION_CAPS: Readonly<Record<string, number>> = { Preferences: 25, "Right now": 10 };
/** The core skill's sections, in order. */
export const CORE_SECTIONS = ["Preferences", "Right now", "Check-in"] as const;
export type CoreSection = (typeof CORE_SECTIONS)[number];

export const DEFAULT_CHECKIN = [
  "- Anything waiting on the user, or threads I started that finished, failed or stalled?",
  "- Project leads: anything stuck?",
];

/** A new Bot's core skill. */
export const CORE_TEMPLATE = `## Preferences

## Right now

## Check-in

${DEFAULT_CHECKIN.join("\n")}
`;

const heading = (line: string) => /^##\s+(.+?)\s*#*\s*$/.exec(line)?.[1]?.trim() ?? null;
/** Headings match case-insensitively, ignoring hyphens, spaces and a plural "s" ("Check-ins" is "Check-in"). */
const norm = (text: string) => text.toLowerCase().replace(/[\s-]+/g, "").replace(/s$/, "");
const same = (a: string, b: string) => norm(a) === norm(b);

/** The section's text under its `## <name>` heading (case-insensitive), or null when there's no such heading. */
export function sectionText(body: string, name: string): string | null {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => { const h = heading(line); return !!h && same(h, name); });
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && !/^#{1,2}\s/.test(lines[end]!)) end++;
  return lines.slice(start + 1, end).join("\n").trim();
}

/** Bullets in a section (lines starting with -, * or 1.). */
export function bulletCount(text: string | null): number {
  return (text ?? "").split("\n").filter((line) => /^\s{0,3}(?:[-*+]|\d+[.)])\s+\S/.test(line)).length;
}

/** The body with one section's text replaced (made at the end when missing). */
export function withSection(body: string, name: string, text: string): string {
  const lines = body.replace(/\s+$/, "").split("\n");
  const start = lines.findIndex((line) => { const h = heading(line); return !!h && same(h, name); });
  const block = text.trim() ? ["", text.trim(), ""] : [""];
  if (start < 0) return `${[...lines, "", `## ${name}`, ...block].join("\n").replace(/^\n+/, "").trimEnd()}\n`;
  let end = start + 1;
  while (end < lines.length && !/^#{1,2}\s/.test(lines[end]!)) end++;
  return `${[...lines.slice(0, start + 1), ...block, ...lines.slice(end)].join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

/** Adds a bullet to the `## Check-in` section (made if missing); null when the line is already there. */
export function addCheckinLine(body: string, line: string): string | null {
  const current = sectionText(body, "Check-in");
  const bullet = `- ${line.trim()}`;
  if (current?.split("\n").some((each) => each.trim() === bullet)) return null;
  return withSection(body, "Check-in", current ? `${current}\n${bullet}` : bullet);
}

/** Advisory notes on an always-on skill: the shared character budget and the section caps. */
export function lintAlwaysOn(body: string, totalChars: number): string[] {
  const notes: string[] = [];
  if (totalChars > ALWAYS_ON_CAP) notes.push(`Always-on skills are ${totalChars.toLocaleString("en-US")} characters together, over the ${ALWAYS_ON_CAP.toLocaleString("en-US")} budget. They go into every prompt: merge or remove lines, or move topic rules to an on-demand skill.`);
  for (const [name, cap] of Object.entries(SECTION_CAPS)) {
    const count = bulletCount(sectionText(body, name));
    if (count > cap) notes.push(`"## ${name}" has ${count} lines; its cap is ${cap}. Prune or merge an old line before you add one.`);
  }
  return notes;
}

/** Characters an always-on skill takes in the prompt. */
export const alwaysOnChars = (body: string) => body.trim().length;
