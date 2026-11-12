// The one-time, automatic split of a Bot's old Memory page into a core
// profile page and memory records. Pure: it reads Markdown and returns a
// plan; the caller (./service.ts) writes the new page and records, once per
// Bot, on its own. The old page is never changed by anything here or there.
//
// Heuristics:
// - Units: every heading of every level (below a lone H1 title) starts a
//   unit holding the text up to the next heading of any level, so each
//   "### People" under "## Memory" is its own unit. A parent's own text,
//   before its first sub-heading, is a unit named after the parent; a parent
//   with no text of its own (blank lines and rules only) is no unit. Text
//   above the first heading is records, like any other unit.
// - Labels: a unit is labelled with its own heading, prefixed by its
//   immediate parent's heading ("Projects › Larkspur") unless that parent is a
//   catch-all bucket whose words are all like "Memory", "Notes", "Misc" or
//   "Facts and decisions" (CATCH_ALL_WORDS; possessives like "Sam's" are
//   ignored), so "## Memory" › "### Fork" is just "Fork". The label is the
//   records' default topic and their source section.
// - The core profile keeps only the Bot's check-in list and how the user
//   works: a unit whose own heading, or a heading above it, is "Check-in" or
//   "How <name> works" (PROFILE_HEADING, any case). Every other unit becomes
//   records.
// - The cap: when those units together are longer than PROFILE_CAP_CHARS,
//   the longest one goes to records, and again, until the profile fits.
// - In the profile each unit keeps a heading: its own heading one level
//   below its nearest parent that is also in the profile, else its label at
//   level 2, so the profile reads well whatever was moved out.
// - In a records unit each top-level list item (with its nested items),
//   paragraph, quote or table row is one record. Its topic is the unit's
//   label (or a short bold label leading the item), cleaned of emoji and
//   punctuation; its date is the first date in its text (2026-11-07, Nov 7,
//   7 Nov 2026, 11/7/2026) when it's not after the page's last edit (a later
//   one is a due date), else the page's last edit. A code block joins the
//   record above it.
import { cleanTopic, PROFILE_CAP_CHARS } from "./shared";

export type SplitTarget = "profile" | "records";

/** Headings that stay in the core profile: the check-in list ("Check-in", "Check-ins") and how the user works ("How Patrick works", "How he works"). */
export const PROFILE_HEADING = /\bcheck[-\s]?ins?\b|\bhow\s+(?!(?:it|this|that)\s)(?:[\p{L}\p{N}'’]+\s+)?works?\b/iu;

/** Words of a catch-all heading that says nothing about what's under it: see `catchAll`. */
const CATCH_ALL_WORDS = new Set(["memory", "memories", "notes", "note", "misc", "miscellaneous", "other", "general", "facts", "fact", "decisions", "decision", "and", "info", "information", "details", "context", "knowledge", "log", "journal", "stuff", "things", "to", "remember", "topics", "reference", "long", "term", "the", "my", "our"]);

/** A heading made only of catch-all words ("Memory", "Notes", "Facts and decisions", "Sam's notes"). */
export function catchAll(heading: string): boolean {
  return heading.toLowerCase().split(/[^\p{L}\p{N}'’]+/u).filter((word) => word && !/['’]s?$/.test(word)).every((word) => CATCH_ALL_WORDS.has(word));
}

interface Line { text: string; index: number }
/** A heading above a unit: its own words, and its unit's key when it has text of its own. */
interface Ancestor { name: string; key: string | null }
/** One unit of the split: a heading's own text, up to the next heading of any level. */
interface Section {
  key: string;
  /** The unit's label: its heading, prefixed by a parent that isn't a catch-all. */
  heading: string;
  /** The heading's own words. */
  name: string;
  level: number;
  /** The headings above it, outermost first. */
  ancestors: Ancestor[];
  lines: Line[];
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;
const LIST_ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;

/** A heading as plain words: no emoji, links, emphasis or trailing colon. */
export function headingText(raw: string): string {
  return raw
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/[\s:–—-]+$/u, "")
    .trim();
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "section";
}

/** Splits the page into its intro and units, one per heading of any level, outside code fences. */
export function sections(markdown: string): { title: string | null; intro: Line[]; sections: Section[] } {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const headings: { index: number; level: number; text: string }[] = [];
  let fenced = false;
  lines.forEach((text, index) => {
    if (FENCE.test(text)) { fenced = !fenced; return; }
    const match = fenced ? null : HEADING.exec(text);
    if (match) headings.push({ index, level: match[1]!.length, text: match[2]! });
  });
  const h1s = headings.filter((heading) => heading.level === 1);
  const firstContent = lines.findIndex((line) => line.trim());
  // A lone H1 on the first line is the page's title, not a section.
  const title = h1s.length === 1 && h1s[0]!.index === firstContent ? h1s[0]! : null;
  const rest = headings.filter((heading) => heading !== title);
  const at = (from: number, to: number) => lines.slice(from, to).map((text, offset) => ({ text, index: from + offset }));
  const introStart = title ? title.index + 1 : 0;
  const intro = at(introStart, rest[0]?.index ?? lines.length);
  const seen = new Map<string, number>();
  const stack: (Ancestor & { level: number })[] = [];
  const result: Section[] = [];
  rest.forEach((heading, position) => {
    while (stack.length && stack[stack.length - 1]!.level >= heading.level) stack.pop();
    const name = headingText(heading.text) || "Untitled";
    const ancestors = stack.map(({ name: above, key }) => ({ name: above, key }));
    const own = at(heading.index + 1, rest[position + 1]?.index ?? lines.length);
    const parentOfNext = (rest[position + 1]?.level ?? 0) > heading.level;
    const node: Ancestor & { level: number } = { name, key: null, level: heading.level };
    stack.push(node);
    // A parent with nothing of its own before its first sub-heading is no unit.
    if (parentOfNext && !own.some((line) => line.text.trim() && !RULE.test(line.text))) return;
    const parent = ancestors[ancestors.length - 1];
    const label = parent && !catchAll(parent.name) ? `${parent.name} › ${name}` : name;
    const base = slug(label);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    node.key = n > 1 ? `${base}-${n}` : base;
    result.push({ key: node.key, heading: label, name, level: heading.level, ancestors, lines: own });
  });
  return { title: title ? headingText(title.text) : null, intro, sections: result };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const DATES: { pattern: RegExp; parts(match: RegExpExecArray): [number | null, number, number] }[] = [
  { pattern: /\b(\d{4})-(\d{2})-(\d{2})\b/, parts: (m) => [Number(m[1]), Number(m[2]) - 1, Number(m[3])] },
  { pattern: new RegExp(`\\b${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, "i"), parts: (m) => [m[3] ? Number(m[3]) : null, MONTHS.indexOf(m[1]!.slice(0, 3).toLowerCase()), Number(m[2])] },
  { pattern: new RegExp(`\\b(\\d{1,2})\\s+${MONTH}(?:,?\\s+(\\d{4}))?\\b`, "i"), parts: (m) => [m[3] ? Number(m[3]) : null, MONTHS.indexOf(m[2]!.slice(0, 3).toLowerCase()), Number(m[1])] },
  { pattern: /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/, parts: (m) => [Number(m[3]), Number(m[1]) - 1, Number(m[2])] },
];

/**
 * The first date written in a record's text, at local noon. Without a year
 * it's the latest such date on or before the page's last edit.
 */
export function dateIn(text: string, pageUpdatedAt: number): number | null {
  let best: { at: number; index: number } | null = null;
  for (const { pattern, parts } of DATES) {
    const match = pattern.exec(text);
    if (!match || (best && best.index <= match.index)) continue;
    const [year, month, day] = parts(match);
    if (month < 0 || month > 11 || day < 1 || day > 31) continue;
    const reference = new Date(pageUpdatedAt);
    let at = new Date(year ?? reference.getFullYear(), month, day, 12).getTime();
    if (year === null && at > pageUpdatedAt + 86_400_000) at = new Date(reference.getFullYear() - 1, month, day, 12).getTime();
    if (new Date(at).getDate() !== day) continue;
    best = { at, index: match.index };
  }
  return best?.at ?? null;
}

/** A records section's items: list items with their nested lines, paragraphs, quotes and table rows. */
export function recordItems(lines: readonly Line[], sectionHeading: string): { topic: string; text: string }[] {
  const items: { topic: string; text: string[] }[] = [];
  let topic = sectionHeading;
  let current: { topic: string; text: string[] } | null = null;
  let kind: "list" | "paragraph" | null = null;
  let fence: string[] | null = null;
  let tableHeader: string[] | null = null;
  const close = () => { current = null; kind = null; };
  const start = (text: string, as: "list" | "paragraph") => { current = { topic, text: [text] }; items.push(current); kind = as; };
  for (const { text: raw } of lines) {
    if (fence) {
      fence.push(raw);
      if (FENCE.test(raw)) {
        if (items.length) items[items.length - 1]!.text.push(...fence);
        else items.push({ topic, text: fence });
        fence = null;
      }
      continue;
    }
    if (FENCE.test(raw)) { fence = [raw]; close(); continue; }
    const heading = HEADING.exec(raw);
    if (heading) { topic = headingText(heading[2]!) || sectionHeading; close(); tableHeader = null; continue; }
    if (!raw.trim()) { if (kind === "paragraph") close(); tableHeader = null; continue; }
    if (RULE.test(raw)) { close(); continue; }
    if (TABLE_ROW.test(raw)) {
      close();
      if (TABLE_RULE.test(raw)) continue;
      const cells = raw.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
      if (!tableHeader) { tableHeader = cells; continue; }
      const header = tableHeader;
      items.push({ topic, text: [cells.map((cell, index) => header[index] ? `${header[index]}: ${cell}` : cell).filter((cell) => cell.replace(/^[^:]*:\s*/, "")).join("; ")] });
      continue;
    }
    const item = LIST_ITEM.exec(raw);
    if (item) {
      const nested = item[1]!.replace(/\t/g, "  ").length >= 2;
      if (nested && current && kind === "list") { (current as { text: string[] }).text.push(`- ${item[2]!.trim()}`); continue; }
      start(item[2]!.trim(), "list");
      continue;
    }
    const quote = raw.replace(/^\s*>\s?/, "");
    if (current && (kind === "paragraph" || (kind === "list" && /^\s+\S/.test(raw)))) { (current as { text: string[] }).text.push(quote.trim()); continue; }
    start(quote.trim(), "paragraph");
  }
  if (fence) { if (items.length) items[items.length - 1]!.text.push(...fence); else items.push({ topic, text: fence }); }
  return items
    .map((each) => ({ topic: labelTopic(each.text[0] ?? "") ?? cleanTopic(each.topic), text: each.text.join("\n").trim() }))
    .filter((each) => each.text.replace(/[-*>\s`~]/g, ""));
}

/** A record that leads with a short bold label ("**homelab:** …") takes it as its topic. */
function labelTopic(first: string): string | null {
  const match = /^\*\*([^*]{1,24}?)\*\*\s*[:–—-]?/.exec(first) ?? /^\*\*([^*]{1,24}?):\*\*/.exec(first);
  if (!match) return null;
  const topic = headingText(match[1]!);
  return topic ? cleanTopic(topic) : null;
}


export interface SplitInput {
  markdown: string;
  page: { id: string; title: string; updatedAt: number };
  botName: string;
  /** The most the core profile may hold, in characters (default PROFILE_CAP_CHARS). */
  cap?: number;
}

export interface SplitRecord {
  topic: string;
  text: string;
  createdAt: number;
  /** Whether createdAt is a date found in the text (else the page's last edit). */
  dated: boolean;
  /** The unit's label; null for the text above the first heading. */
  section: string | null;
}

export interface SplitPlan {
  /** Each unit, where it went, and whether it went to records only to fit the cap. */
  sections: { key: string; heading: string; target: SplitTarget; overCap: boolean }[];
  profile: { title: string; markdown: string; chars: number };
  records: SplitRecord[];
}

/** The core profile of a page with no check-in list and nothing on how the user works. */
export const EMPTY_PROFILE = "## How the user works\n\n## Check-in\n";

/** The plan for splitting an old Memory page: what stays in the core profile, and each record. */
export function planSplit(input: SplitInput): SplitPlan {
  const cap = input.cap ?? PROFILE_CAP_CHARS;
  const parsed = sections(input.markdown);
  const units = parsed.sections.map((section) => ({
    ...section,
    profileLike: [section.name, ...section.ancestors.map((above) => above.name)].some((name) => PROFILE_HEADING.test(name)),
  }));
  // A unit's text in the profile: its own heading one level below its nearest parent also in the profile, else its label at level 2.
  const part = (section: (typeof units)[number], inProfile: ReadonlySet<string>) => {
    const above = section.ancestors.filter((ancestor) => ancestor.key && inProfile.has(ancestor.key)).length;
    const parent = section.ancestors[section.ancestors.length - 1];
    const heading = parent?.key && inProfile.has(parent.key) ? section.name : section.heading;
    return [`${"#".repeat(Math.min(6, 2 + above))} ${heading}`, section.lines.map((line) => line.text).join("\n").trim()].filter(Boolean).join("\n\n");
  };
  const inProfile = new Set(units.filter((unit) => unit.profileLike).map((unit) => unit.key));
  const overCap = new Set<string>();
  let parts: { key: string; text: string }[] = [];
  for (;;) {
    parts = units.filter((unit) => inProfile.has(unit.key)).map((unit) => ({ key: unit.key, text: part(unit, inProfile) }));
    if (!parts.length || parts.map((each) => each.text).join("\n\n").length <= cap) break;
    // Over the cap: the longest unit left goes to records, and the rest is measured again.
    const longest = parts.reduce((most, each) => each.text.length > most.text.length ? each : most);
    inProfile.delete(longest.key);
    overCap.add(longest.key);
  }
  const records: SplitRecord[] = [];
  const addRecords = (lines: readonly Line[], topic: string, section: string | null) => {
    for (const item of recordItems(lines, topic)) {
      // A date after the page's last edit is a due date, not when the fact was noted.
      const found = dateIn(item.text, input.page.updatedAt);
      const at = found !== null && found <= input.page.updatedAt + 86_400_000 ? found : null;
      records.push({ topic: item.topic || "Notes", text: item.text, createdAt: at ?? input.page.updatedAt, dated: at !== null, section });
    }
  };
  addRecords(parsed.intro, "Notes", null);
  for (const unit of units) if (!inProfile.has(unit.key)) addRecords(unit.lines, cleanTopic(unit.heading) || "Notes", unit.heading);
  const markdown = parts.length ? `${parts.map((each) => each.text).join("\n\n")}\n` : EMPTY_PROFILE;
  return {
    sections: units.map((unit) => ({ key: unit.key, heading: unit.heading, target: inProfile.has(unit.key) ? "profile" : "records", overCap: overCap.has(unit.key) })),
    profile: { title: `${input.botName}'s core profile`, markdown, chars: markdown.trim().length },
    records,
  };
}
