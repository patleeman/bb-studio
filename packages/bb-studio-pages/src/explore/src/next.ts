// The Next row: one line at the end of a reply with everything the user might
// do next. Runtime-free, so it's bundled into both the server and the app.
//
//   ::next{reply="👍 Ship it|❓ Why" btw="🐛 I noticed … If …, …" do="📄 Write up the plan as a page"}
//
// `reply` items draft a quick answer, and `do` items draft an instruction for
// the agent to carry out. `btw` items are notes back to the user about
// something the agent noticed, in plain sentences, with Tell me more (asks
// this agent), Visual explainer (an explainer page) and, for 🐛 notes, Fix this. Replies from before `btw` carry
// `explore="🐛 Label — why"` instead; those show as notes too. Attributes come
// from the model, so parsing caps and dedupes them.
import { labelKey, MAX_ITEMS, MAX_LABEL_LENGTH, parseExploreItem, parseExploreItems, type ExploreItem } from "./shared";

export const NEXT_DIRECTIVE = "next";

/** What the click log counts: quick replies, Visual explainer, actions, Fix this, and Tell me more. */
export const NEXT_KINDS = ["reply", "explore", "do", "fix", "more"] as const;
export type NextKind = (typeof NEXT_KINDS)[number];

/** Each group's cap. */
export const NEXT_LIMITS = { reply: 5, btw: 3, do: 3 } as const;

/** A note back to the user. `label` names its explainer; `text` is what the user reads. */
export interface BtwNote {
  emoji: string;
  label: string;
  text: string;
}

export interface NextItems {
  reply: ExploreItem[];
  btw: BtwNote[];
  do: ExploreItem[];
}

/** Notes are a sentence or two, not a paragraph. */
export const MAX_NOTE_LENGTH = 280;
/** The emoji for notes that look broken; they get Fix this. */
export const BUG_EMOJI = "🐛";

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

function clean(text: string): string {
  return text.replace(/[\u0000-\u001f"{}]/g, " ").replace(/\s+/g, " ").trim();
}

function cutText(text: string, max: number): string {
  if (text.length <= max) return text;
  const room = text.slice(0, max - 1);
  const space = room.lastIndexOf(" ");
  return `${(space > max / 2 ? room.slice(0, space) : room).trimEnd()}…`;
}

/** A short, stable hash of a note's text (FNV-1a), to tell apart notes that start the same. */
export function noteHash(text: string): string {
  let hash = 0x811c9dc5;
  for (const char of labelKey(text)) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, "0");
}

/**
 * `btw` notes: an emoji and one or two sentences. A note's label (its
 * explainer's identity) is its first words; when two different notes start
 * the same, the later one's label ends with a hash of its whole text, so the
 * first keeps the label older explainers were saved under.
 */
export function parseBtwNotes(raw: string | undefined, max: number = NEXT_LIMITS.btw): BtwNote[] {
  if (typeof raw !== "string") return [];
  const labels = new Set<string>();
  const texts = new Set<string>();
  const notes: BtwNote[] = [];
  for (const part of raw.slice(0, 4_000).split("|")) {
    const item = parseExploreItem(part);
    if (!item) continue;
    // parseExploreItem cleans the same way, so a leading emoji is exactly `item.emoji`.
    const whole = clean(part);
    const full = whole.startsWith(item.emoji) ? whole.slice(item.emoji.length).trim() : whole;
    const text = cutText(full, MAX_NOTE_LENGTH);
    if (!text || texts.has(labelKey(full))) continue;
    texts.add(labelKey(full));
    let label = item.label;
    if (labels.has(labelKey(label))) label = `${cutText(full, MAX_LABEL_LENGTH - 9)} #${noteHash(full)}`;
    if (labels.has(labelKey(label))) continue;
    labels.add(labelKey(label));
    notes.push({ emoji: item.emoji, label, text });
    if (notes.length >= max) break;
  }
  return notes;
}

export function parseNextItems(attributes: Readonly<Record<string, string | undefined>>): NextItems {
  const btw = parseBtwNotes(attributes.btw);
  const legacy = parseExploreWithWhy(attributes.explore, MAX_ITEMS).map((item) => ({
    emoji: item.emoji,
    label: item.label,
    text: item.why ? `${item.label} — ${item.why}` : item.label,
  }));
  return {
    reply: parseExploreItems(attributes.reply, NEXT_LIMITS.reply),
    btw: btw.length ? btw : legacy,
    do: parseExploreItems(attributes.do, NEXT_LIMITS.do),
  };
}

export function nextItemCount(items: NextItems): number {
  return items.reply.length + items.btw.length + items.do.length;
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
