// Scores a filing against the labels. The run's strands are matched to the
// labels' one to one (greedy, by how many messages they share), so two of
// the run's strands can't both claim one labeled strand and one strand of
// the run can't stand for two: a sorter that lumps or splits loses points.
import type { EvalConversation, EvalTurn, Filing } from "./types";

export interface Score {
  /** User messages, and reports with a reply the user reads (what today's sorter sorts). */
  sortable: { right: number; total: number };
  /** The user's own messages. */
  user: { right: number; total: number };
  /** Every scored turn, workers' quiet reports included. */
  all: { right: number; total: number };
  /** Messages about the whole conversation that went to the whole-conversation strand. */
  trunk: { right: number; total: number };
  /** Asks the labels say were answered and that cleared. */
  clears: { right: number; total: number };
  /** Sortable messages whose main strand is the label, an also, or the parent or a child of one (a split or lump along a branch). */
  lineage: { right: number; total: number };
  /** Of the labeled strands with a parent, those whose matched strand has the matched parent. */
  parents: { right: number; total: number };
  /** Run strand id -> label key. */
  mapping: Map<string, string>;
  wrong: { seq: number; want: string; got: string | null }[];
}

const QUIET = /^\s*(?:\[PASS\]|PASS|\[SILENT\])?\s*$/i;
export const isSortableTurn = (turn: EvalTurn) => turn.kind === "user" || (!!turn.text.trim() && !QUIET.test(turn.reply));

/**
 * The one-to-one match. Only sortable messages vote (`basis: "sortable"`, the
 * default), so the many quiet reports a sorter now files can't decide which
 * labeled strand a run strand stands for; "all" lets every turn vote.
 */
export function matchStrands(conversation: EvalConversation, filing: Filing, basis: "sortable" | "all" = "sortable"): Map<string, string> {
  const votes = new Map<string, number>();
  for (const turn of conversation.turns) {
    if (turn.label.skip || (basis === "sortable" && !isSortableTurn(turn))) continue;
    const got = filing.bySeq.get(turn.seq);
    if (!got?.length) continue;
    const want = [turn.label.strand, ...turn.label.also];
    // The main strand votes for the main label; extra strands vote for the extra labels (half a vote).
    got.forEach((id, index) => {
      if (filing.trunk.has(id)) return;
      const targets = index === 0 ? [want[0]!] : want.slice(1);
      for (const key of targets) if (key !== "trunk" && key !== "none") votes.set(`${id}\u0000${key}`, (votes.get(`${id}\u0000${key}`) ?? 0) + (index === 0 ? 1 : 0.5));
    });
  }
  const mapping = new Map<string, string>();
  const taken = new Set<string>();
  for (const [pair] of [...votes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    const [id, key] = pair.split("\u0000") as [string, string];
    if (mapping.has(id) || taken.has(key)) continue;
    mapping.set(id, key);
    taken.add(key);
  }
  for (const id of filing.trunk) mapping.set(id, "trunk");
  return mapping;
}

/**
 * Each measure matches strands on the turns it scores: sortable messages
 * (and user messages, lineage, trunk) on the sortable ones, `all` on every
 * turn. `basis` forces one match for everything.
 */
export function score(conversation: EvalConversation, filing: Filing, basis?: "sortable" | "all"): Score {
  const mapping = matchStrands(conversation, filing, basis ?? "sortable");
  const allMapping = matchStrands(conversation, filing, basis ?? "all");
  const out: Score = { sortable: { right: 0, total: 0 }, user: { right: 0, total: 0 }, all: { right: 0, total: 0 }, trunk: { right: 0, total: 0 }, clears: { right: 0, total: 0 }, parents: { right: 0, total: 0 }, lineage: { right: 0, total: 0 }, mapping, wrong: [] };
  const parentOf = new Map(conversation.strands.map((strand) => [strand.key, strand.parent]));
  // Several of the run's strands may stand for one label along a branch: match each run strand to its best label, without the one-to-one rule.
  const loose = looseMatch(conversation, filing);
  for (const turn of conversation.turns) {
    if (turn.label.skip) continue;
    const got = filing.bySeq.get(turn.seq);
    const keys = (got ?? []).map((id) => mapping.get(id) ?? `?${id}`);
    // Right when the main strand is one the message is about; "none" only when filed in none.
    const rightBy = (byId: Map<string, string>) => {
      const main = got?.[0];
      return turn.label.strand === "none" ? got !== null && got !== undefined && got.length === 0 : !!main && [turn.label.strand, ...turn.label.also].includes(byId.get(main) ?? "");
    };
    const right = rightBy(mapping);
    const add = (bucket: { right: number; total: number }) => { bucket.total++; if (right) bucket.right++; };
    out.all.total++;
    if (rightBy(allMapping)) out.all.right++;
    if (isSortableTurn(turn)) add(out.sortable);
    if (turn.kind === "user") add(out.user);
    if (turn.label.strand === "trunk") add(out.trunk);
    if (isSortableTurn(turn)) {
      const family = new Set<string>();
      for (const key of [turn.label.strand, ...turn.label.also]) {
        family.add(key);
        const parent = parentOf.get(key);
        if (parent) family.add(parent);
        for (const [child, of] of parentOf) if (of === key) family.add(child);
      }
      out.lineage.total++;
      const main = got?.[0];
      if (main !== undefined && (family.has(mapping.get(main) ?? "") || family.has(loose.get(main) ?? ""))) out.lineage.right++;
      else if (turn.label.strand === "none" && got && !got.length) out.lineage.right++;
    }
    if (!right) out.wrong.push({ seq: turn.seq, want: turn.label.strand, got: got === null || got === undefined ? null : keys[0] ?? "none" });
  }
  // Only asks the sorter saw (tagged needs-you) can clear; one it never tagged counts as missed.
  if (filing.openAsks && filing.askedTurns) {
    for (const turn of conversation.turns) for (const asked of turn.label.clears ?? []) { out.clears.total++; if (filing.askedTurns.has(asked) && !filing.openAsks.has(asked)) out.clears.right++; }
  }
  const byKey = new Map([...mapping].map(([id, key]) => [key, id]));
  for (const strand of conversation.strands) {
    if (!strand.parent) continue;
    const id = byKey.get(strand.key);
    const parent = byKey.get(strand.parent);
    out.parents.total++;
    if (id && parent && filing.parents.get(id) === parent) out.parents.right++;
  }
  return out;
}

/** Each run strand's best label by shared messages, many to one. */
function looseMatch(conversation: EvalConversation, filing: Filing): Map<string, string> {
  const votes = new Map<string, Map<string, number>>();
  for (const turn of conversation.turns) {
    const main = filing.bySeq.get(turn.seq)?.[0];
    if (turn.label.skip || !main || filing.trunk.has(main)) continue;
    const byKey = votes.get(main) ?? new Map<string, number>();
    byKey.set(turn.label.strand, (byKey.get(turn.label.strand) ?? 0) + 1);
    votes.set(main, byKey);
  }
  const out = new Map<string, string>();
  for (const [id, byKey] of votes) out.set(id, [...byKey].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0]);
  for (const id of filing.trunk) out.set(id, "trunk");
  return out;
}

/** Today's filing, from the fixture. */
export function todayFiling(conversation: EvalConversation): Filing {
  const bySeq = new Map<number, string[] | null>();
  for (const turn of conversation.turns) bySeq.set(turn.seq, turn.today === "unsorted" ? null : turn.today === null ? [] : [turn.today]);
  return { bySeq, trunk: new Set(), parents: new Map() };
}

export const percent = (bucket: { right: number; total: number }) => (bucket.total ? `${Math.round((100 * bucket.right) / bucket.total)}% (${bucket.right}/${bucket.total})` : "-");

export function formatScore(name: string, result: Score, calls?: { jev?: number; model?: number }): string {
  return [
    `${name}: sortable ${percent(result.sortable)} · lineage ${percent(result.lineage)} · user ${percent(result.user)} · all ${percent(result.all)} · trunk ${percent(result.trunk)} · clears ${percent(result.clears)} · parents ${percent(result.parents)}`,
    calls ? `  calls: Jev ${calls.jev ?? 0}, small model ${calls.model ?? 0}` : "",
  ].filter(Boolean).join("\n");
}
