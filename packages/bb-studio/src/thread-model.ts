// A thread's model, never assumed. BB stores a model on a thread after its
// first turn; a thread made before any provider was ready, or one whose
// provider has no default model, has none, and BB then refuses to send there
// ("Thread … has no stored execution model"). Studio's schedules (check-ins,
// runners, reminders) and Make this the Main read a thread's model, so each
// one goes through threadModel: the thread's own model, else the Bot's
// default model when it is on the same provider, else the provider's default
// model. The fallback is saved on the thread (threads.update, as BB's composer
// does), so BB can send there from then on. With none of them, the caller
// says "Choose a model" (NO_MODEL) rather than BB's raw error.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

type Sdk = BbPluginApi["sdk"];

/** What a schedule says when a thread has no model and nothing to fall back on: plain words with the action. */
export const NO_MODEL = "has no model yet. Choose a model for it (open it and pick one in the composer, or set the Bot's default model in Bot settings).";

/** A model to fall back on: the Bot's default model, when it has one. */
export type PreferredModel = { providerId: string; model: string; reasoning?: string | null } | null | undefined;

export type ThreadModel = { providerId: string; model: string; reasoningLevel: string | null; permissionMode: string | null; projectId: string | null; filled: boolean };

/** BB's answer for a thread with no model (src/bot.ts noStoredModel says the same). */
export function missingModel(error: unknown): boolean {
  return /has no stored execution model/i.test(String((error as Error)?.message ?? error));
}

/**
 * Whether BB refused a thread for its model or provider (no stored model, a
 * model it doesn't offer, a provider that is signed out or unavailable): the
 * only errors worth retrying on another model. A timeout or a dropped
 * connection is not one, since BB may have made the thread already.
 */
export function modelProblem(error: unknown): boolean {
  if (missingModel(error)) return true;
  const text = String((error as Error)?.message ?? error);
  if (/time(d)? ?out|ECONN|socket hang up|network|fetch failed|aborted/i.test(text)) return false;
  return /not signed in|signed out|unauthenticated|sign in|login required|\b(model|provider)\b[^.]*\b(not found|unknown|isn't|is not|doesn't|does not|unavailable|not available|not supported|invalid)\b|\b(unknown|unsupported|invalid) (model|provider)\b/i.test(text);
}

/** The provider's default model (its catalog's isDefault, else its first), or null when it is signed out or lists none. */
export async function providerDefaultModel(sdk: Sdk, providerId: string): Promise<string | null> {
  try {
    const models = (await sdk.providers.models({ providerId })).models as readonly { model: string; isDefault?: boolean }[];
    return (models.find((each) => each.isDefault) ?? models[0])?.model ?? null;
  } catch {
    return null;
  }
}

/**
 * The model a thread runs on, filled when it has none (see the top of the
 * file). Null when the thread has no provider, or neither the Bot nor the
 * provider offers a model. Throws only when the thread can't be read.
 */
export async function threadModel(sdk: Sdk, threadId: string, preferred?: PreferredModel): Promise<ThreadModel | null> {
  const [thread, options] = await Promise.all([
    sdk.threads.get({ threadId }) as Promise<{ providerId?: string | null; projectId?: string | null }>,
    sdk.threads.defaultExecutionOptions({ threadId }).catch(() => null) as Promise<{ model?: string | null; reasoningLevel?: string | null; permissionMode?: string | null } | null>,
  ]);
  const providerId = thread.providerId ?? null;
  if (!providerId) return null;
  const base = { providerId, reasoningLevel: options?.reasoningLevel ?? null, permissionMode: options?.permissionMode ?? null, projectId: thread.projectId ?? null };
  if (options?.model) return { ...base, model: options.model, filled: false };
  const fallback = preferred?.providerId === providerId && preferred.model ? preferred.model : await providerDefaultModel(sdk, providerId);
  if (!fallback) return null;
  const reasoning = preferred?.providerId === providerId ? preferred.reasoning ?? null : null;
  // Saved on the thread, so BB can send there (a check-in's turn, the user's next message).
  await sdk.threads.update({ threadId, model: fallback, ...(reasoning ? { reasoningLevel: reasoning } : {}) } as never).catch(() => {});
  return { ...base, model: fallback, reasoningLevel: reasoning ?? base.reasoningLevel, filled: true };
}
