// Which rule fits a task: Jev first (short budget), then one tool-less call
// to the AI service the user picked for thread titles with what is left of
// the total budget, then the default chain. Late answers are dropped; nothing
// waits past the total budget. Neither step starts an agent or a thread.
import { ROUTER_CALLER, type DecisionSource, type Policy } from "./contract";
import { modelPrompt, ruleFromJev, ruleFromModel, ruleQuestion, ruleState, type RuleAnswer } from "./select";

export const JEV_BUDGET_MS = 1_500;
export const TOTAL_BUDGET_MS = 5_000;

type Failure = { ok: false; unavailable?: boolean; reason?: string; error?: string; message?: string };

/** The two classifiers: Studio Decisions' Jev, and BB's one-line model call (`experimental_completeText`). */
export interface RouterDecisions {
  systemOne(
    input: { caller: string; state: unknown; questions: Record<string, ReturnType<typeof ruleQuestion>> },
    signal: AbortSignal,
  ): Promise<{ ok: true; answers: Record<string, unknown>; via: string; ms: number } | Failure>;
  /** Null when this BB has no tool-less model call. */
  completeText: ((input: { prompt: string; timeoutMs: number }, signal: AbortSignal) => Promise<{ ok: true; text: string } | Failure>) | null;
}

export interface RuleChoice {
  ruleId: string | null;
  source: DecisionSource;
  confidence: number | null;
  ms: number;
}

/** Runs `ask` with its own abort signal; resolves undefined once `ms` passes, a throw or a late answer. */
async function within<T>(ms: number, ask: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
  if (ms <= 0) return undefined;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(undefined);
    }, ms);
  });
  try {
    return await Promise.race([ask(controller.signal).catch(() => undefined), late]);
  } finally {
    clearTimeout(timer);
  }
}

export async function chooseRule(
  decisions: RouterDecisions,
  input: { policy: Policy; text: string },
  budget: { jevMs: number; totalMs: number } = { jevMs: JEV_BUDGET_MS, totalMs: TOTAL_BUDGET_MS },
  now: () => number = Date.now,
): Promise<RuleChoice> {
  const started = now();
  const done = (answer: RuleAnswer, source: DecisionSource): RuleChoice => ({ ...answer, source, ms: now() - started });
  if (input.policy.rules.length === 0 || input.text.trim() === "") return done({ ruleId: null, confidence: null }, "no-rules");

  const jev = await within(Math.min(budget.jevMs, budget.totalMs), (signal) =>
    decisions.systemOne({ caller: ROUTER_CALLER, state: ruleState(input.policy, input.text), questions: { rule: ruleQuestion(input.policy) } }, signal),
  );
  const fromJev = jev?.ok ? ruleFromJev(input.policy, jev.answers.rule) : undefined;
  if (fromJev) return done(fromJev, "jev");

  const complete = decisions.completeText;
  if (complete) {
    const left = budget.totalMs - (now() - started);
    const reply = await within(left, (signal) => complete({ prompt: modelPrompt(input.policy, input.text), timeoutMs: left }, signal));
    const fromModel = reply?.ok ? ruleFromModel(input.policy, reply.text) : undefined;
    if (fromModel) return done(fromModel, "model");
  }
  return done({ ruleId: null, confidence: null }, "default");
}
