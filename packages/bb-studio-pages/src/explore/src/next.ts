// The Next row: one line at the end of a reply with everything the user might
// do next. Runtime-free, so it's bundled into both the server and the app.
//
//   ::next{reply="👍 Ship it|❓ Why" explore="🐛 Retry backoff disagrees|🏗️ How the queue works" do="📄 Write up the plan as a page"}
//
// `reply` items draft a quick answer, `explore` items write an explainer, and
// `do` items draft an instruction for the agent to carry out. Attributes come
// from the model, so parsing caps and dedupes them like `::explore` does.
import { labelKey, MAX_ITEMS, parseExploreItem, parseExploreItems, type ExploreItem } from "./shared";

export const NEXT_DIRECTIVE = "next";

export const NEXT_KINDS = ["reply", "explore", "do"] as const;
export type NextKind = (typeof NEXT_KINDS)[number];

/** Each group's cap. */
export const NEXT_LIMITS: Record<NextKind, number> = { reply: 5, explore: MAX_ITEMS, do: 3 };

export type NextItems = Record<NextKind, ExploreItem[]>;

/** Separates an explore item's label from why it matters: `🐛 Label — why`. */
const WHY_SEPARATOR = /\s+(?:—|--)\s+/;
/** Longer reasons are cut: one line under the label, not a paragraph. */
export const MAX_WHY_LENGTH = 160;

function cutWhy(text: string): string {
  const clean = text.replace(/[\u0000-\u001f"{}]/g, " ").replace(/\s+/g, " ").trim();
  if (clean.length <= MAX_WHY_LENGTH) return clean;
  const room = clean.slice(0, MAX_WHY_LENGTH - 1);
  const space = room.lastIndexOf(" ");
  return `${(space > MAX_WHY_LENGTH / 2 ? room.slice(0, space) : room).trimEnd()}…`;
}

/** Explore items with an optional reason after an em dash. */
export function parseExploreWithWhy(raw: string | undefined, max: number): ExploreItem[] {
  if (typeof raw !== "string") return [];
  const seen = new Set<string>();
  const items: ExploreItem[] = [];
  for (const part of raw.slice(0, 4_000).split("|")) {
    const [head, ...rest] = part.split(WHY_SEPARATOR);
    const item = parseExploreItem(head);
    if (!item) continue;
    const key = labelKey(item.label);
    if (seen.has(key)) continue;
    seen.add(key);
    const why = cutWhy(rest.join(" — "));
    items.push(why ? { ...item, why } : item);
    if (items.length >= max) break;
  }
  return items;
}

export function parseNextItems(attributes: Readonly<Record<string, string | undefined>>): NextItems {
  return Object.fromEntries(
    NEXT_KINDS.map((kind) => [kind, kind === "explore" ? parseExploreWithWhy(attributes[kind], NEXT_LIMITS[kind]) : parseExploreItems(attributes[kind], NEXT_LIMITS[kind])]),
  ) as NextItems;
}

export function nextItemCount(items: NextItems): number {
  return NEXT_KINDS.reduce((total, kind) => total + items[kind].length, 0);
}

/** One suggestion's identity in the click log: the same label in the same message is one suggestion. */
export function suggestionKey(input: { threadId: string; messageId: string; kind: NextKind; label: string }): string {
  return JSON.stringify([input.threadId, input.messageId, input.kind, labelKey(input.label)]);
}

/** Studio Reactions' plugin id: its saved reactions are the preferred replies. */
export const REACTIONS_PLUGIN_ID = "emoji-react";

/** Studio Reactions' saved `emojiItems` ("👍 Agree, 👎 Disagree") as reply items, or null when unset. */
export function preferredReplies(raw: unknown): string[] | null {
  if (typeof raw !== "string") return null;
  return raw
    .split(/[,;\n]/)
    .map((part) => part.replace(/["|{}]/g, " ").replace(/\s+/g, " ").trim())
    .filter((part) => /^\S+ \S/.test(part) && part.length <= 60)
    .slice(0, 8);
}
