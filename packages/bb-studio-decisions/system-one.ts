import { z } from "zod";
import { describeHttpFailure, jevRoutes, type JevProviderSettings, type JevRoute } from "./jev-providers";
import { commandToken, forgetCommandToken, hasCommandToken } from "./key-command";

/**
 * TypeSafe's System One protocol: the caller sends untrusted `state` and named
 * questions, and Jev answers each one. A `noul` question returns a
 * probability; a `choice` question picks one of its criteria's keys.
 */
const probability = z.number().min(0).max(1);
const questionId = z.string().trim().min(1).max(120);
export const questionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("noul"), instructions: z.string().min(1).max(4000) }).strict(),
  z
    .object({
      type: z.literal("choice"),
      instructions: z.string().min(1).max(4000),
      criteria: z
        .record(questionId, z.string().min(1).max(2000))
        .refine((criteria) => Object.keys(criteria).length >= 2 && Object.keys(criteria).length <= 32, {
          message: "A choice needs between 2 and 32 options.",
        }),
    })
    .strict(),
]);
export const questionsSchema = z
  .record(questionId, questionSchema)
  .refine((questions) => Object.keys(questions).length >= 1 && Object.keys(questions).length <= 64, {
    message: "Ask between 1 and 64 questions.",
  });
export const answerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("noul"), noul: probability }),
  z.object({
    type: z.literal("choice"),
    choice: z.string(),
    confidence: probability,
    probabilities: z.record(z.string(), probability),
  }),
]);
export type Question = z.infer<typeof questionSchema>;
export type Questions = Record<string, Question>;
export type Answer = z.infer<typeof answerSchema>;
export type Answers = Record<string, Answer>;

const responseSchema = z.object({ answers: z.record(z.string(), answerSchema) });

export type SystemOneSettings = JevProviderSettings & { jevTimeoutMs?: number };
const timeoutSchema = z.number().int().min(250).max(15000).catch(5000);

/** Nothing is configured to answer. Expected, so callers need not log it as a failure. */
export class UnavailableError extends Error {}
export class JevUnavailableError extends UnavailableError {}

/** Jev answers are small; a larger body from a custom endpoint is refused. */
const maxResponseBytes = 64 * 1024;

async function boundedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The response had no body.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxResponseBytes) {
      await reader.cancel();
      throw new Error("The response was too large.");
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const errorBodySchema = z.union([
  z.object({ errors: z.array(z.object({ detail: z.string() })).min(1) }).transform((body) => body.errors[0]!.detail),
  z.object({ detail: z.string() }).transform((body) => body.detail),
  z.object({ error: z.object({ message: z.string() }) }).transform((body) => body.error.message),
  z.object({ error: z.string() }).transform((body) => body.error),
  z.object({ message: z.string() }).transform((body) => body.message),
]);

/** The provider's own reason for a failed request, so a rejected model or header is visible in the logs. */
async function errorDetail(response: Response): Promise<string | null> {
  try {
    const parsed = errorBodySchema.safeParse(await boundedJson(response));
    return parsed.success ? parsed.data.replace(/\s+/g, " ").trim().slice(0, 300) || null : null;
  } catch {
    await response.body?.cancel().catch(() => {});
    return null;
  }
}

/** Every question answered with its own type, and every choice one of its options. */
function checkedAnswers(route: JevRoute, questions: Questions, answers: Answers): Answers {
  const result: Answers = {};
  for (const [id, question] of Object.entries(questions)) {
    const answer = answers[id];
    if (!answer || answer.type !== question.type) throw new Error(`${route.name} omitted a required decision.`);
    if (question.type === "choice" && answer.type === "choice" && !Object.hasOwn(question.criteria, answer.choice))
      throw new Error(`${route.name} returned an unknown decision option.`);
    result[id] = answer;
  }
  return result;
}

async function askRoute(
  route: JevRoute,
  state: string,
  questions: Questions,
  timeoutMs: number,
  signal: AbortSignal,
  retried = false,
): Promise<Answers> {
  const reused = !!route.apiKeyCommand && hasCommandToken(route.apiKeyCommand);
  const bearer = route.apiKeyCommand ? await commandToken(route.apiKeyCommand) : route.apiKey;
  signal.throwIfAborted();
  // Node 20's AbortSignal.any() holds its sources weakly, so a bare
  // AbortSignal.timeout() there can be collected before it fires. Own the timer.
  const request = new AbortController();
  const abort = () => request.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () => request.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError")),
    timeoutMs,
  );
  try {
    const response = await fetch(route.endpoint, {
      method: "POST",
      redirect: "error",
      headers: {
        ...route.headers,
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        "Content-Type": "application/json",
        ...(route.id === "openrouter"
          ? { "HTTP-Referer": "https://github.com/patleeman/bb-studio", "X-OpenRouter-Title": "BB Studio Decisions" }
          : {}),
      },
      body: JSON.stringify({ model: route.model, state, questions }),
      signal: request.signal,
    });
    if (!response.ok) {
      const detail = await errorDetail(response);
      if (route.apiKeyCommand && (response.status === 401 || response.status === 403)) {
        forgetCommandToken(route.apiKeyCommand);
        // A cached token can be revoked before its expiry; a fresh one gets one more try.
        if (reused && !retried) return askRoute(route, state, questions, timeoutMs, signal, true);
      }
      throw new Error(describeHttpFailure(route, response.status, detail));
    }
    const parsed = responseSchema.safeParse(await boundedJson(response));
    if (!parsed.success) throw new Error(`${route.name} returned an invalid decision response.`);
    return checkedAnswers(route, questions, parsed.data.answers);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

/**
 * Asks each configured Jev provider in order until one answers. `state` is
 * sent as a JSON string, so the model reads it as data.
 */
export async function askSystemOne(
  settings: SystemOneSettings,
  request: { state: unknown; questions: Questions },
  signal: AbortSignal,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ answers: Answers; via: string }> {
  signal.throwIfAborted();
  const timeoutMs = timeoutSchema.parse(settings.jevTimeoutMs ?? 5000);
  const { routes, problems } = jevRoutes(settings, env);
  if (!routes.length) throw new JevUnavailableError(problems.join(" ") || "No Jev provider is configured.");
  const state = JSON.stringify(request.state);
  const failures = [...problems];
  for (const route of routes) {
    try {
      return { answers: await askRoute(route, state, request.questions, timeoutMs, signal), via: route.name };
    } catch (error) {
      signal.throwIfAborted();
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(failures.join(" "));
}
