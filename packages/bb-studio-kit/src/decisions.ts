import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { publicContract, type Answers, type Questions, type ModelSelection } from "./decisions-contract";

export { publicContract } from "./decisions-contract";
export type { Answer, Answers, Question, Questions } from "./decisions-contract";

export class DecisionsUnavailableError extends Error {}

export type JevAsk = (state: unknown, questions: Questions, signal: AbortSignal) => Promise<Answers>;
export type ModelAsk = (
  request: { requestId: string; hostId: string; providerId: string | null; prompt: string },
  signal: AbortSignal,
) => Promise<string | null>;

const installHint = "Install and enable Studio Decisions, then set up its Jev provider or fallback model.";
const setupHint = "Set up a Jev provider or fallback model in Studio Decisions settings.";

class DecisionsFailure extends Error {}

type Failure = { ok: false; unavailable: boolean; error: string };
function unwrap<T extends { ok: true }>(result: T | Failure): T {
  if (!result.ok) throw result.unavailable ? new DecisionsUnavailableError(`${result.error} ${setupHint}`) : new DecisionsFailure(result.error);
  return result;
}

async function callRpc<T extends { ok: true }>(
  bb: BbPluginApi, method: "systemOne.ask" | "model.ask", input: unknown,
  outputSchema: typeof publicContract["systemOne.ask"]["output"] | typeof publicContract["model.ask"]["output"],
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  try {
    const result = await bb.sdk.plugins.callRpc({
      signal, pluginId: "smart-decisions", method, input: input as never,
      outputSchema: outputSchema as typeof publicContract["systemOne.ask"]["output"],
    });
    signal.throwIfAborted();
    return unwrap(result as T | Failure);
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof DecisionsUnavailableError) throw error;
    if (error instanceof DecisionsFailure) throw error;
    throw new DecisionsUnavailableError(`Studio Decisions did not answer. ${installHint} (${error instanceof Error ? error.message : String(error)})`);
  }
}

export function askSystemOne(bb: BbPluginApi, request: { caller: string; state: unknown; questions: Questions }, signal: AbortSignal) {
  return callRpc<{ ok: true; answers: Answers; via: string; ms: number }>(bb, "systemOne.ask", request, publicContract["systemOne.ask"].output, signal);
}

export function askModel(
  bb: BbPluginApi,
  request: { caller: string; requestId: string; hostId: string; providerId: string | null; prompt: string; modelSelection?: ModelSelection },
  signal: AbortSignal,
) {
  return callRpc<{ ok: true; text: string | null; via: string; ms: number }>(bb, "model.ask", request, publicContract["model.ask"].output, signal);
}

/** Title prompts use Decisions' configured fallback and the same cleanup as every model request. */
export async function askTitle(
  bb: BbPluginApi,
  request: { caller: string; requestId: string; hostId: string; providerId: string | null; prompt: string; modelSelection?: ModelSelection },
  signal: AbortSignal,
): Promise<string | null> {
  return (await askModel(bb, request, signal)).text;
}

export function decisionsClient(bb: BbPluginApi, caller = "studio"): { jev: JevAsk; model: ModelAsk } {
  return {
    jev: async (state, questions, signal) => (await askSystemOne(bb, { caller, state, questions }, signal)).answers,
    model: async (request, signal) => (await askModel(bb, { caller, ...request }, signal)).text,
  };
}
