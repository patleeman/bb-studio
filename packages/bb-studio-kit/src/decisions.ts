import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { publicContract, type ModelSelection } from "./decisions-contract";

export { publicContract } from "./decisions-contract";
export type { Answer, Answers, Question, Questions } from "./decisions-contract";

export class DecisionsUnavailableError extends Error {}

const installHint = "Install and enable Studio Decisions, then set up its Jev provider or fallback model.";
const setupHint = "Set up a Jev provider or fallback model in Studio Decisions settings.";

class DecisionsFailure extends Error {}

type Failure = { ok: false; unavailable: boolean; error: string };
function unwrap<T extends { ok: true }>(result: T | Failure): T {
  if (!result.ok) throw result.unavailable ? new DecisionsUnavailableError(`${result.error} ${setupHint}`) : new DecisionsFailure(result.error);
  return result;
}

export async function askModel(
  bb: BbPluginApi,
  request: { caller: string; requestId: string; hostId: string; providerId: string | null; prompt: string; modelSelection?: ModelSelection },
  signal: AbortSignal,
): Promise<{ ok: true; text: string | null; via: string; ms: number }> {
  signal.throwIfAborted();
  try {
    const result = await bb.sdk.plugins.callRpc({
      signal, pluginId: "smart-decisions", method: "model.ask", input: request,
      outputSchema: publicContract["model.ask"].output,
    });
    signal.throwIfAborted();
    return unwrap(result as { ok: true; text: string | null; via: string; ms: number } | Failure);
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof DecisionsUnavailableError) throw error;
    if (error instanceof DecisionsFailure) throw error;
    throw new DecisionsUnavailableError(`Studio Decisions did not answer. ${installHint} (${error instanceof Error ? error.message : String(error)})`);
  }
}

/** Title prompts use Decisions' configured fallback and the same cleanup as every model request. */
export async function askTitle(
  bb: BbPluginApi,
  request: { caller: string; requestId: string; hostId: string; providerId: string | null; prompt: string; modelSelection?: ModelSelection },
  signal: AbortSignal,
): Promise<string | null> {
  return (await askModel(bb, request, signal)).text;
}
