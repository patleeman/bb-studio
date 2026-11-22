// The strand-sorting eval (see README.md): three synthetic conversations
// shaped like real ones, every message labeled. The old sorter's filing (as
// simulated in each fixture's "today") is scored; each conversation is replayed through the real StrandService with the
// recorded answers of a stand-in for Jev, so a change to sorting shows up here
// as a score (re-record after changing what Jev is asked).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { recordedJev, recordedModel, type Recording } from "./answers";
import { replay } from "./replay";
import { formatScore, score, todayFiling } from "./score";
import type { EvalConversation } from "./types";

const here = (...parts: string[]) => join(__dirname, ...parts);
const load = (name: string) => JSON.parse(readFileSync(here("conversations", `${name}.json`), "utf8")) as EvalConversation;
const NAMES = ["team-lead", "side-project", "household"] as const;

describe("the labels", () => {
  it.each(NAMES)("%s: every turn labeled once, every key a labeled strand", (name) => {
    const conversation = load(name);
    const keys = new Set(conversation.strands.map((strand) => strand.key));
    const seqs = conversation.turns.map((turn) => turn.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    for (const turn of conversation.turns) for (const key of [turn.label.strand, ...turn.label.also]) expect(key === "trunk" || key === "none" || keys.has(key)).toBe(true);
    for (const strand of conversation.strands) if (strand.parent) expect(keys.has(strand.parent)).toBe(true);
  });
});

describe("the old sorter's filing (simulated in each fixture)", () => {
  const TODAY: Record<(typeof NAMES)[number], number> = { "team-lead": 17, "side-project": 13, household: 12 };
  it.each(NAMES)("%s", (name) => {
    const conversation = load(name);
    const result = score(conversation, todayFiling(conversation));
    console.log(formatScore(`${conversation.title} (today)`, result));
    expect(result.sortable.right).toBe(TODAY[name]);
    expect(result.trunk.right).toBe(0);
    expect(result.parents.right).toBe(0);
  });
});

/** The replay's floor for each conversation: right sortable messages and right turns overall (quiet reports included). */
const FLOOR: Record<(typeof NAMES)[number], { sortable: number; all: number }> = JSON.parse(readFileSync(here("recorded", "floor.json"), "utf8"));

describe("replayed with the recorded answers", () => {
  it.each(NAMES)("%s", async (name) => {
    const conversation = load(name);
    const file = here("recorded", `${conversation.id}.json`);
    expect(existsSync(file)).toBe(true);
    const recording = JSON.parse(readFileSync(file, "utf8")) as Recording;
    const misses: string[] = [];
    const result = await replay(conversation, { jev: recordedJev(recording, misses), model: recordedModel(recording, misses) });
    const scored = score(conversation, result);
    console.log(formatScore(conversation.title, scored, { jev: result.jevCalls, model: result.modelCalls }));
    // Every question was asked exactly as recorded: a change to the prompts needs a new recording.
    expect(misses).toEqual([]);
    expect(scored.sortable.right).toBeGreaterThanOrEqual(FLOOR[name].sortable);
    expect(scored.all.right).toBeGreaterThanOrEqual(FLOOR[name].all);
  }, 60_000);
});
