// Names and directive parsing the server and the app share.
// Runtime-free (only constants), so it's bundled into both.

/** The directive: `::explore{items="🐛 Retry backoff disagrees in billing|🏗️ How the job queue works"}`. */
export const DIRECTIVE = "explore";
/** A reply lists at most this many findings. */
export const MAX_ITEMS = 4;
/** Longer labels are cut: a finding is a line, not a paragraph. */
export const MAX_LABEL_LENGTH = 80;
/** A finding the model wrote without an emoji gets this one. */
export const DEFAULT_EMOJI = "🔎";

export interface ExploreItem {
  emoji: string;
  /** The finding without its emoji, e.g. "How the job queue works". */
  label: string;
  /** Why it matters to the user, from the Next row. Not part of its identity. */
  why?: string;
}

const EMOJI = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]️?⃣)/u;

/** Case- and space-insensitive identity of a label, for dedupe and lookups. */
export function labelKey(label: string): string {
  return label.replace(/\s+/g, " ").trim().toLowerCase();
}

function cut(label: string): string {
  if (label.length <= MAX_LABEL_LENGTH) return label;
  const room = label.slice(0, MAX_LABEL_LENGTH - 1);
  const space = room.lastIndexOf(" ");
  return `${(space > MAX_LABEL_LENGTH / 2 ? room.slice(0, space) : room).trimEnd()}…`;
}

/** One `emoji label` item. The emoji is optional; the label isn't. */
export function parseExploreItem(raw: string): ExploreItem | null {
  // Attributes come from the model: drop quotes, braces and control characters.
  const text = raw.replace(/[\u0000-\u001f"{}]/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (EMOJI.test(text)) {
    // The first grapheme, so "🐛Retry" (no space) splits too and 🏗️ keeps its variation selector.
    const first = new Intl.Segmenter().segment(text)[Symbol.iterator]().next().value?.segment ?? "";
    const label = cut(text.slice(first.length).trim());
    return label ? { emoji: first.slice(0, 16), label } : null;
  }
  return { emoji: DEFAULT_EMOJI, label: cut(text) };
}

/** The directive's `items` attribute: `|`-separated, capped, deduped. */
export function parseExploreItems(raw: string | undefined | null, max = MAX_ITEMS): ExploreItem[] {
  if (typeof raw !== "string") return [];
  const seen = new Set<string>();
  const items: ExploreItem[] = [];
  for (const part of raw.slice(0, 4_000).split("|")) {
    const item = parseExploreItem(part);
    if (!item) continue;
    const key = labelKey(item.label);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
    if (items.length >= max) break;
  }
  return items;
}

/** Back into the attribute form. */
export function formatExploreItems(items: readonly ExploreItem[]): string {
  return items.map((item) => `${item.emoji} ${item.label}`).join("|");
}
