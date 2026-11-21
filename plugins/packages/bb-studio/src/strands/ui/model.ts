// What the strands UI shows, as pure functions (design dsn_398fde78c3b1f6b8,
// screen 4a): text only, neutral marks, amber only for "needs you".
import type { StrandAsk, StrandList, StrandView } from "../contract";

export type Tags = { tags: readonly { turnId: string; seq: number; strandId: string | null }[]; strands: readonly { id: string; title: string }[] };

/** A message's tag: its turn's strand, and whether a divider goes above it (the strand changed since the last sorted turn). */
export function tagOf(tags: Tags | null | undefined, turnId: string | null): { strandId: string; title: string; divider: boolean; seq: number } | null {
  if (!tags || !turnId) return null;
  const at = tags.tags.findIndex((tag) => tag.turnId === turnId);
  const tag = at >= 0 ? tags.tags[at] : undefined;
  if (!tag?.strandId) return null;
  const title = tags.strands.find((strand) => strand.id === tag.strandId)?.title;
  if (!title) return null;
  let before: string | null = null;
  for (let index = at - 1; index >= 0; index--) { const strandId = tags.tags[index]!.strandId; if (strandId) { before = strandId; break; } }
  return { strandId: tag.strandId, title, divider: before !== tag.strandId, seq: tag.seq };
}

/** The strand's messages (each sorted turn's first seq), oldest first, for stepping through it. */
export function seqsOf(tags: Tags | null | undefined, strandId: string): number[] {
  return (tags?.tags ?? []).filter((tag) => tag.strandId === strandId).map((tag) => tag.seq);
}

/** One message on from `current` (a seq) in `seqs`: -1 older, 1 newer; from nothing, the newest. */
export function stepSeq(seqs: readonly number[], current: number | null, by: -1 | 1): number | null {
  if (!seqs.length) return null;
  if (current === null) return seqs.at(-1)!;
  const at = seqs.indexOf(current);
  if (at < 0) return by < 0 ? [...seqs].reverse().find((seq) => seq < current) ?? seqs[0]! : seqs.find((seq) => seq > current) ?? seqs.at(-1)!;
  return seqs[Math.max(0, Math.min(seqs.length - 1, at + by))]!;
}

/** How many strands are in each live state, for the line's counts. */
export function countsOf(list: StrandList | null | undefined): { needs: number; running: number; finished: number; waiting: number; open: number; quiet: number } {
  const counts = { needs: 0, running: 0, finished: 0, waiting: 0, open: 0, quiet: 0 };
  for (const strand of list?.strands ?? []) {
    if (strand.state === "needs-you") counts.needs++;
    else if (strand.state === "running") counts.running++;
    else if (strand.state === "done-unseen") counts.finished++;
    else if (strand.state === "waiting") counts.waiting++;
    else if (strand.state === "quiet") counts.quiet++;
    else counts.open++;
  }
  return counts;
}

/** Whether anything is open: a strand that isn't quiet. With none, the line takes no space. */
export const hasOpen = (list: StrandList | null | undefined) => (list?.strands ?? []).some((strand) => strand.state !== "quiet");

/** The line's strand: the selected one, else the one the newest sorted message is in. */
export function currentOf(list: StrandList | null | undefined, selection: { strandId: string } | null): StrandView | null {
  const strands = list?.strands ?? [];
  if (selection) { const chosen = [...strands, ...(list?.earlier ?? [])].find((strand) => strand.id === selection.strandId); if (chosen) return chosen; }
  return strands.reduce<StrandView | null>((best, strand) => (strand.latestSeq !== null && (best?.latestSeq ?? -1) < strand.latestSeq ? strand : best), null);
}

export const GROUPS: readonly { label: string; states: readonly StrandView["state"][] }[] = [
  { label: "Needs you", states: ["needs-you"] },
  { label: "Running", states: ["running"] },
  { label: "Finished", states: ["done-unseen"] },
  { label: "Waiting on someone else", states: ["waiting"] },
  { label: "Open", states: ["active"] },
  { label: "Quiet", states: ["quiet"] },
];

/** The workbench tab's groups, in order, empty ones left out. */
export function groupsOf(list: StrandList | null | undefined): { label: string; strands: StrandView[] }[] {
  return GROUPS.map((group) => ({ label: group.label, strands: (list?.strands ?? []).filter((strand) => group.states.includes(strand.state)) })).filter((group) => group.strands.length);
}

/** How long ago, in the strip's few characters: "5m", "3h", "2 days". */
export function ageOf(at: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return days === 1 ? "1 day" : `${days} days`;
}

/** An approval's buttons, in BB's words and order (Approve first). */
export function decisionButtons(ask: StrandAsk): { decision: StrandAsk["decisions"][number]; label: string; primary: boolean }[] {
  const label = { allow_once: "Approve", allow_for_session: "Always allow", deny: "Deny" } as const;
  const order = ["allow_once", "allow_for_session", "deny"] as const;
  return order.filter((decision) => ask.decisions.includes(decision)).map((decision) => ({ decision, label: label[decision], primary: decision === "allow_once" }));
}

/** Whether the strands strip takes the In flight strip's place in this conversation. */
export const stripShown = (list: StrandList | null | undefined) => !!list?.enabled && list.strands.length > 0;
