// Structural signals for sorting: facts read from the conversation itself,
// never guesses from keywords. Which worker a report is from (BB writes the
// thread id), the text a user quotes ("> " lines) and whether that text is an
// earlier reply's, and a reply's end kept as context.
import { plainLine } from "../conversation-text";
import { isSilentOutput } from "../kit/silent";
import { LINE_MAX } from "./store";

/**
 * The threads a report is from: the senders BB names in its headers
 * ("[bb message from thread:thr_…]", "@thread:thr_… completed"); only when
 * it has no header, the thread ids its text names.
 */
export function workerMentions(text: string): string[] {
  const senders = [...text.matchAll(/\[bb message from thread:(thr_[a-z0-9]{6,})\]|@thread:(thr_[a-z0-9]{6,}) completed\b/gi)].map((match) => match[1] ?? match[2]!);
  if (senders.length) return [...new Set(senders)];
  return [...new Set(text.match(/\bthr_[a-z0-9]{6,}\b/gi) ?? [])];
}

/**
 * Quoted passages: each "> " line, markdown off. A line is its own passage
 * (a reply quoted bit by bit puts lines from different paragraphs together).
 * Lines under 12 characters aren't kept.
 */
export function quotesOf(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/u)) {
    const quoted = /^\s{0,3}>\s?(.*)$/u.exec(line);
    const passage = quoted ? plainLine(quoted[1]!) : "";
    if (passage.length >= 12 && !out.includes(passage)) out.push(passage);
  }
  return out;
}

/** Text as compared: markdown off, lower case, only letters and digits, single spaces. */
export const folded = (text: string) => plainLine(text).toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Whether `quote` is taken from `text`: its start (up to 120 characters, an ellipsis cut off) appears in it. */
export function sameText(text: string, quote: string): boolean {
  const wanted = folded(quote.replace(/…\s*$/u, "")).slice(0, 120).trim();
  return wanted.length >= 12 && folded(text).includes(wanted);
}

/** Whether a quoted passage holds an ask word for word (or, for a long ask cut in the quote, the ask holds the passage). */
export function askInQuote(ask: string, quote: string): boolean {
  const a = folded(ask.replace(/…\s*$/u, ""));
  const q = folded(quote.replace(/…\s*$/u, ""));
  if (a.length < 12 || q.length < 12) return false;
  return q.includes(a.slice(0, 160)) || (q.length >= 40 && a.includes(q));
}

/** A reply's end as an item line: the context the next sort reads; null for a quiet reply. */
export function replyLine(text: string | null | undefined): string | null {
  if (!text?.trim() || isSilentOutput(text)) return null;
  const line = plainLine(text);
  return line.length > LINE_MAX ? `…${line.slice(-(LINE_MAX - 1))}` : line;
}

/** Whether a message is exactly one of a reply's quick replies (a button the user pressed, or its words typed as they were): leading emoji and case aside. */
export function isQuickReply(message: string, quick: readonly string[]): boolean {
  const bare = (text: string) => folded(text.replace(/^[^\p{L}\p{N}]+/u, ""));
  const said = bare(message);
  return !!said && quick.some((each) => bare(each) === said);
}
