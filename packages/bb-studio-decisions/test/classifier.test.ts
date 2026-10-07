import { test, vi, afterEach, onTestFinished } from "vitest";
afterEach(() => vi.restoreAllMocks());
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  JevUnavailableError,
  askBatch,
  askJev,
  classify,
  modelPrompt,
  parseModelVerdict,
  situationState,
  type Situation,
  type Verdict,
} from "../classifier";

const situation: Situation = {
  title: "Build storage",
  requests: ["Add caching", "Implement storage with PostgreSQL"],
  latestOutput: "Creating the migration now.",
  message: "Actually, use SQLite instead.",
};
const jevAnswer = (choice: string, confidence: number) => ({
  answers: { action: { type: "choice", choice, confidence, probabilities: { [choice]: confidence } } },
});

const signal = () => AbortSignal.timeout(1000);
/** No ambient keys: tests must not depend on the machine running them. */
const env = {};

test("Jev receives the running task and the new message as data", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    return Response.json(jevAnswer("steer", 0.92));
  });
  const verdict = await askJev({ typesafeApiKey: "k" }, situation, signal(), env);
  assert.deepEqual(verdict, { action: "steer", source: "jev", confidence: 0.92, note: null, via: "TypeSafe" });
  assert.equal(calls[0]!.url, "https://api.typesafe.ai/v1/systemone");
  assert.equal((calls[0]!.init!.headers as Record<string, string>).Authorization, "Bearer k");
  const body = JSON.parse(String(calls[0]!.init.body));
  assert.equal(body.model, "jev-latest");
  assert.deepEqual(Object.keys(body.questions.action.criteria), ["steer", "followup"]);
  const state = JSON.parse(body.state);
  assert.equal(state.currentTask, "Implement storage with PostgreSQL");
  assert.equal(state.message, "Actually, use SQLite instead.");
});

test("an uncertain Jev steer becomes a follow-up", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(jevAnswer("steer", 0.5)));
  const verdict = await askJev({ zenApiKey: "k", steerConfidence: 0.7 }, situation, signal(), env);
  assert.equal(verdict.action, "followup");
  assert.match(verdict.note ?? "", /unsure/);
});

test("Jev without any provider is unavailable, not an error", async () => {
  await assert.rejects(askJev({}, situation, signal(), env), JevUnavailableError);
});

test("auto moves to the next provider when one fails", async () => {
  const urls: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url: string | URL | Request) => {
    urls.push(String(url));
    return String(url).includes("typesafe.ai") ? new Response("busy", { status: 529 }) : Response.json(jevAnswer("followup", 0.9));
  });
  const verdict = await askJev({ typesafeApiKey: "a", zenApiKey: "b" }, situation, signal(), env);
  assert.deepEqual(urls, ["https://api.typesafe.ai/v1/systemone", "https://opencode.ai/zen/v1/systemone"]);
  assert.equal(verdict.via, "OpenCode Zen");
});

test("Jev reports every failed provider, and rejects unknown options", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("no", { status: 402 }));
  await assert.rejects(
    askJev({ typesafeApiKey: "a", openRouterApiKey: "b" }, situation, signal(), env),
    /TypeSafe says the account is out of credit.*OpenRouter says the account is out of credit/,
  );
  fetchMock.mockImplementation(async () => Response.json(jevAnswer("fork", 1)));
  await assert.rejects(askJev({ zenApiKey: "k" }, situation, signal(), env), /unknown/);
});

test("a failed Jev request reports the provider's reason", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    Response.json(
      { errors: [{ detail: "Unsupported provider in model field: typesafe.", status: 400 }] },
      { status: 400 },
    ),
  );
  await assert.rejects(
    askJev({ typesafeApiKey: "a" }, situation, signal(), env),
    /^Error: TypeSafe request failed \(HTTP 400\)\. Unsupported provider in model field: typesafe\.$/,
  );
});

test("a custom endpoint gets its own model, and no auth header without a key", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    return Response.json(jevAnswer("followup", 0.9));
  });
  const verdict = await askJev(
    { jevProvider: "custom", customJevEndpoint: "http://localhost:8080/v1/systemone", customJevModel: "jev-local" },
    situation,
    signal(),
    env,
  );
  assert.equal(verdict.via, "Custom (localhost:8080)");
  assert.equal(JSON.parse(String(calls[0]!.init.body)).model, "jev-local");
  assert.equal("Authorization" in (calls[0]!.init!.headers as Record<string, string>), false);
});

test("an oversized response is refused", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("x".repeat(70 * 1024)));
  await assert.rejects(askJev({ zenApiKey: "k" }, situation, signal(), env), /too large/);
});

test("classification falls back from Jev to the model, then to follow-up", async () => {
  const model: Verdict = { action: "steer", source: "model", confidence: null, note: null };
  const warnings: string[] = [];
  const warn = (message: string) => warnings.push(message);
  const signal = AbortSignal.timeout(1000);

  const noKey = await classify(
    { jev: async () => { throw new JevUnavailableError("no key"); }, model: async () => model, warn },
    signal,
  );
  assert.deepEqual(noKey, model);
  assert.deepEqual(warnings, [], "a missing key is expected, not a warning");

  const neither = await classify(
    {
      jev: async () => { throw new Error("HTTP 500"); },
      model: async () => { throw new Error("provider down"); },
      warn,
    },
    signal,
  );
  assert.equal(neither.action, "followup");
  assert.equal(neither.source, "default");
  assert.match(neither.note ?? "", /HTTP 500.*provider down/);
});

test("the model prompt carries bounded data and parses strict JSON", () => {
  const prompt = modelPrompt({ ...situation, message: "x".repeat(20000) });
  assert.match(prompt, /untrusted conversation data/);
  assert.equal(situationState({ ...situation, message: "x".repeat(20000) }).message.length, 16000);
  assert.equal(parseModelVerdict('```json\n{"action":"steer"}\n```').action, "steer");
  // Observed live: a small model renamed the key and added a reason.
  assert.equal(parseModelVerdict('{"decision":"follow-up","reason":"separate task"}').action, "followup");
  assert.equal(parseModelVerdict('Answer: {"action":"Steer"}').action, "steer");
  assert.throws(() => parseModelVerdict('{"action":"fork"}'));
  assert.throws(() => parseModelVerdict("steer"));
});

test("the fallback model's decision is read even when braces follow it", () => {
  assert.equal(parseModelVerdict('{"action":"steer"}\nIt narrows the task, so {steer} fits.').action, "steer");
  assert.equal(parseModelVerdict('Context {draft} then {"action":"followup"}').action, "followup");
});

test("a rejected cached command token is refreshed and retried once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "smart-queue-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  // Prints tok-1, tok-2, ... so each run of the command yields a new token.
  const command = `n=$(cat "${dir}/n" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "${dir}/n"; echo tok-$n`;
  const settings = { customJevEndpoint: "https://gw.example.com/v1/systemone", customJevModel: "jev", customJevApiKeyCommand: command };
  const bearers: string[] = [];
  let reject = new Set<string>();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url: string | URL | Request, init?: RequestInit) => {
    const bearer = (init!.headers as Record<string, string>).Authorization!;
    bearers.push(bearer);
    return reject.has(bearer) ? new Response("{}", { status: 401 }) : Response.json(jevAnswer("followup", 0.9));
  });
  await askJev(settings, situation, signal(), env);
  reject = new Set(["Bearer tok-1"]);
  await askJev(settings, situation, signal(), env);
  assert.deepEqual(bearers, ["Bearer tok-1", "Bearer tok-1", "Bearer tok-2"]);
  reject = new Set(["Bearer tok-2", "Bearer tok-3"]);
  await assert.rejects(askJev(settings, situation, signal(), env), /rejected the API key \(HTTP 401\)/);
  assert.deepEqual(bearers.slice(3), ["Bearer tok-2", "Bearer tok-3"], "a fresh token that fails is not retried");
});

test("a custom endpoint sends its extra headers and the key command's token", async () => {
  const calls: RequestInit[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(init!);
    return Response.json(jevAnswer("followup", 0.9));
  });
  const settings = {
    customJevEndpoint: "https://gw.example.com/v1/systemone",
    customJevModel: "jev",
    customJevApiKeyCommand: "echo cmd-token",
    customJevHeaders: "source: bb-smart-queue; org-id: 2",
  };
  await askJev(settings, situation, signal(), env);
  const headers = calls[0]!.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer cmd-token");
  assert.equal(headers.source, "bb-smart-queue");
  assert.equal(headers["org-id"], "2");
});

test("Jev picks the follow-ups that belong in the next turn, as data, above the batch threshold", async () => {
  let body: { state: string; questions: Record<string, { type: string }> } | null = null;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url: string | URL | Request, init?: RequestInit) => {
    body = JSON.parse(String(init!.body));
    return Response.json({ answers: { m1: { type: "noul", noul: 0.2 }, m2: { type: "noul", noul: 0.6 } } });
  });
  const result = await askBatch(
    { typesafeApiKey: "k", batchConfidence: 0.5 },
    {
      title: "Build storage",
      next: "Use SQLite",
      messages: [
        { id: "q_2", text: "Also, what's for lunch?" },
        { id: "q_3", text: "And keep the old schema" },
      ],
    },
    signal(),
    env,
  );
  assert.deepEqual(result, { ids: ["q_3"], via: "TypeSafe" });
  assert.deepEqual(Object.keys(body!.questions), ["m1", "m2"]);
  assert.equal(body!.questions.m1!.type, "noul");
  assert.deepEqual(JSON.parse(body!.state).messages, { m1: "Also, what's for lunch?", m2: "And keep the old schema" });
});
