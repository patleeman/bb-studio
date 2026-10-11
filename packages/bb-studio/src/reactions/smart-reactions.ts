// Legacy smart reactions. Agents no longer write them (Studio Pages' Next row
// offers quick replies now), but older replies may end with
//
//   ::reactions{items="👍 Ship it|🧪 Add tests first|❓ Why this approach"}
//
// and the frontend still renders that line as reaction buttons, so it never
// shows as raw text. Items are separated by `|` because labels often contain commas.
// Directive attributes come from the model, so they are untrusted: parsing
// caps the count and length and drops anything that is not "emoji label".
import { parseEmojiItem, type EmojiItem } from "./emoji-items";

/** The directive name: `::reactions{items="…"}`. */
export const SMART_REACTIONS_DIRECTIVE = "reactions";

/** A reply offers at most this many reactions. */
export const MAX_SMART_REACTIONS = 5;

/** Longer items are dropped: a reaction is a short reply, not a paragraph. */
export const MAX_SMART_REACTION_LENGTH = 60;

/** An emoji glyph: pictographs, flags (regional indicators), and keycaps. */
const EMOJI = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20E3]/u;

/** Parse the directive's `items` attribute into reaction items. */
export function parseSmartReactions(raw: string | undefined): EmojiItem[] {
  if (typeof raw !== "string") return [];
  const seen = new Set<string>();
  const items: EmojiItem[] = [];
  for (const part of raw.split("|")) {
    const text = part.replace(/\s+/g, " ").trim();
    if (text.length === 0 || text.length > MAX_SMART_REACTION_LENGTH) continue;
    const item = parseEmojiItem(text);
    // A bare word is not a reaction, and neither is a label with no emoji:
    // the button shows the first token as the emoji.
    if (item.label.length === 0 || !EMOJI.test(item.emoji) || seen.has(item.text)) continue;
    seen.add(item.text);
    items.push(item);
    if (items.length >= MAX_SMART_REACTIONS) break;
  }
  return items;
}
