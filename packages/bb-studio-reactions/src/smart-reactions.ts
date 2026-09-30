// Smart reactions — the assistant suggests the reactions for each reply.
//
// When the `smartReactions` setting is on, the server adds instructions that
// ask the assistant to end a reply that needs an answer with one directive
// line:
//
//   ::reactions{items="👍 Ship it|🧪 Add tests first|❓ Why this approach"}
//
// The frontend renders that directive as a row of reaction buttons under the
// message. Items are separated by `|` because labels often contain commas.
// Directive attributes come from the model, so they are untrusted: parsing
// caps the count and length and drops anything that is not "emoji label".
import { parseEmojiItem, type EmojiItem } from "./emoji-items";

/** The directive name: `::reactions{items="…"}`. */
export const SMART_REACTIONS_DIRECTIVE = "reactions";

/** A reply offers at most this many reactions. */
export const MAX_SMART_REACTIONS = 5;

/** Longer items are dropped: a reaction is a short reply, not a paragraph. */
export const MAX_SMART_REACTION_LENGTH = 60;

/** Parse the directive's `items` attribute into reaction items. */
export function parseSmartReactions(raw: string | undefined): EmojiItem[] {
  if (typeof raw !== "string") return [];
  const seen = new Set<string>();
  const items: EmojiItem[] = [];
  for (const part of raw.split("|")) {
    const text = part.replace(/\s+/g, " ").trim();
    if (text.length === 0 || text.length > MAX_SMART_REACTION_LENGTH) continue;
    const item = parseEmojiItem(text);
    // A bare word is not a reaction; the button shows the emoji.
    if (item.label.length === 0 || seen.has(item.text)) continue;
    seen.add(item.text);
    items.push(item);
    if (items.length >= MAX_SMART_REACTIONS) break;
  }
  return items;
}

/**
 * Instructions for the assistant. The user's configured reactions are the
 * preferred set, but the assistant writes its own when the reply offers
 * specific choices.
 */
export function smartReactionInstructions(configured: readonly EmojiItem[]): string {
  const preferred = configured.map((item) => item.text).join(" | ");
  return [
    "Smart reactions are on. When your reply ends by asking the user to decide, choose, approve, or answer something, finish it with one extra line that offers quick replies:",
    `::${SMART_REACTIONS_DIRECTIVE}{items="👍 Looks good|🔁 Try another way|❓ Explain more"}`,
    `Rules: put the line last, on its own line. Give 2 to ${MAX_SMART_REACTIONS} items separated by |. Each item is one emoji, a space, and a label of at most 5 words. Each item must make sense as the user's whole reply to your message. Do not use double quotes or | inside a label. Leave the line out when your reply needs no answer, and never put it inside a code block.`,
    preferred.length > 0
      ? `Use these reactions from the user's settings when they fit: ${preferred}. Write specific ones when your reply offers distinct options.`
      : "Write reactions that match the options in your reply.",
  ].join("\n");
}
