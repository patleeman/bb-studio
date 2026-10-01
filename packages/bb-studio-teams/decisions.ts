import { errorMessage } from "@bb-studio/kit/format";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

/**
 * Studio Decisions owns the fast-model setup: Jev provider keys and the
 * fallback model. Studio Teams asks it over plugin RPC, so there is one place
 * to configure them.
 */
export const decisionsPluginId = "smart-decisions";

const probability = z.number().min(0).max(1);
export const jevAnswerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("noul"), noul: probability }),
  z.object({
    type: z.literal("choice"),
    choice: z.string(),
    confidence: probability,
    probabilities: z.record(z.string(), probability),
  }),
]);
export type JevAnswer = z.infer<typeof jevAnswerSchema>;
export type JevQuestion =
  | { type: "noul"; instructions: string }
  | { type: "choice"; instructions: string; criteria: Record<string, string> };
export type JevAsk = (
  state: unknown,
  questions: Record<string, JevQuestion>,
  signal: AbortSignal,
) => Promise<Record<string, JevAnswer>>;
export type ModelAsk = (
  request: { requestId: string; hostId: string; providerId: string | null; prompt: string },
  signal: AbortSignal,
) => Promise<string | null>;

const failure = z.object({ ok: z.literal(false), unavailable: z.boolean(), error: z.string() });
const systemOneResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), answers: z.record(z.string(), jevAnswerSchema), via: z.string() }),
  failure,
]);
const modelResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), text: z.string().nullable(), via: z.string() }),
  failure,
]);

/** Studio Decisions is missing, off, or has nothing configured to answer. */
export class DecisionsUnavailableError extends Error {}

const installHint = "Install and enable Studio Decisions, then set up its Jev provider or fallback model.";
const setupHint = "Set up a Jev provider or fallback model in Studio Decisions settings.";

async function call<T extends { ok: boolean }>(
  bb: BbPluginApi,
  method: string,
  input: Record<string, unknown>,
  outputSchema: z.ZodType<T>,
  signal: AbortSignal,
): Promise<Extract<T, { ok: true }>> {
  signal.throwIfAborted();
  let result: T;
  try {
    result = await bb.sdk.plugins.callRpc({
      signal,
      pluginId: decisionsPluginId,
      method,
      input: { caller: "bot-teams", ...input } as never,
      outputSchema,
    });
  } catch (error) {
    signal.throwIfAborted();
    // The host reports a missing or disabled plugin as a failed call.
    throw new DecisionsUnavailableError(`Studio Decisions did not answer. ${installHint} (${errorMessage(error)})`);
  }
  signal.throwIfAborted();
  const outcome = result as T & ({ ok: true } | z.infer<typeof failure>);
  if (!outcome.ok) {
    const { unavailable, error } = outcome as z.infer<typeof failure>;
    throw unavailable ? new DecisionsUnavailableError(`${error} ${setupHint}`) : new Error(error);
  }
  return outcome as Extract<T, { ok: true }>;
}

export function decisionsClient(bb: BbPluginApi): { jev: JevAsk; model: ModelAsk } {
  return {
    jev: async (state, questions, signal) =>
      (await call(bb, "systemOne.ask", { state: state as never, questions }, systemOneResult, signal)).answers,
    model: async (request, signal) => (await call(bb, "model.ask", request, modelResult, signal)).text,
  };
}
