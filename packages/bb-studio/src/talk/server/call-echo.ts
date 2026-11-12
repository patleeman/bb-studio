// Echo on a call without headphones: the mic hears the other people through
// the speakers, so "Me" repeats what "Them" said. The helper's voice
// processing cancels most of it; this drops a "me" piece whose words closely
// match "them" pieces that overlap it in time.

export interface EchoCandidate {
  id: string;
  speaker?: "me" | "them" | null;
  startedAt: number;
  durationMs: number;
  status: string;
  text: string | null;
  echo?: boolean;
}

/** How far apart in time two pieces may sit and still count as overlapping (the echo arrives late). */
export const ECHO_SLACK_MS = 1_500;
/** Share of a "me" piece's word pairs that must appear in the overlapping "them" text. */
export const ECHO_MATCH = 0.6;

export function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function pairs(tokens: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < tokens.length; i++) out.push(`${tokens[i]} ${tokens[i + 1]}`);
  return out;
}

/**
 * Whether `mine` repeats `theirs`. Short pieces ("yeah", "okay, sure") must
 * match exactly, so a real "yes" over the other side's "yes, let's do that"
 * stays; longer ones by the share of their word pairs found in `theirs`.
 */
export function isEcho(mine: string, theirs: string): boolean {
  const me = words(mine);
  const them = words(theirs);
  if (me.length === 0 || them.length === 0) return false;
  if (me.length < 4) return me.join(" ") === them.join(" ");
  const available = new Map<string, number>();
  for (const pair of pairs(them)) available.set(pair, (available.get(pair) ?? 0) + 1);
  const mePairs = pairs(me);
  let found = 0;
  for (const pair of mePairs) {
    const left = available.get(pair) ?? 0;
    if (left > 0) {
      found++;
      available.set(pair, left - 1);
    }
  }
  return found / mePairs.length >= ECHO_MATCH;
}

function overlaps(a: EchoCandidate, b: EchoCandidate, slackMs: number): boolean {
  return a.startedAt < b.startedAt + b.durationMs + slackMs && b.startedAt < a.startedAt + a.durationMs + slackMs;
}

/** Ids of transcribed "me" pieces that echo the "them" pieces around them. */
export function echoSegments(segments: readonly EchoCandidate[], slackMs = ECHO_SLACK_MS): string[] {
  const done = segments.filter((segment) => segment.status === "done" && segment.text?.trim());
  const them = done.filter((segment) => segment.speaker === "them");
  if (!them.length) return [];
  const out: string[] = [];
  for (const mine of done) {
    if (mine.speaker !== "me" || mine.echo) continue;
    // The other side's words around it, in order, as one text: an echo can straddle two of their pieces.
    const around = them.filter((theirs) => overlaps(mine, theirs, slackMs));
    if (!around.length) continue;
    const theirText = around.map((theirs) => theirs.text!).join(" ");
    if (isEcho(mine.text!, theirText) || around.some((theirs) => isEcho(mine.text!, theirs.text!))) out.push(mine.id);
  }
  return out;
}
