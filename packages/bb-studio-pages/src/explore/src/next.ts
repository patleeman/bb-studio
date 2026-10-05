// The Next row: one line at the end of a reply with everything the user might
// do next. Runtime-free, so it's bundled into both the server and the app.
//
//   ::next{reply="👍 Ship it|❓ Why" explore="🐛 Retry backoff disagrees|🏗️ How the queue works" do="📄 Write up the plan as a page"}
//
// `reply` items draft a quick answer, `explore` items write an explainer, and
// `do` items draft an instruction for the agent to carry out. Attributes come
// from the model, so parsing caps and dedupes them like `::explore` does.
import { labelKey, MAX_ITEMS, parseExploreItems, type ExploreItem } from "./shared";

export const NEXT_DIRECTIVE = "next";

export const NEXT_KINDS = ["reply", "explore", "do"] as const;
export type NextKind = (typeof NEXT_KINDS)[number];

/** Each group's cap. */
export const NEXT_LIMITS: Record<NextKind, number> = { reply: 5, explore: MAX_ITEMS, do: 3 };

export type NextItems = Record<NextKind, ExploreItem[]>;

export function parseNextItems(attributes: Readonly<Record<string, string | undefined>>): NextItems {
  return Object.fromEntries(NEXT_KINDS.map((kind) => [kind, parseExploreItems(attributes[kind], NEXT_LIMITS[kind])])) as NextItems;
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
