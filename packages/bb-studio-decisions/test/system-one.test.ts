import { test, vi, afterEach } from "vitest";
afterEach(() => vi.restoreAllMocks());
import assert from "node:assert/strict";
import { publicContract } from "../contract";
import type { Questions } from "@bb-studio/kit/decisions-contract";
import { askSystemOne, JevUnavailableError, UnavailableError } from "../system-one";

const signal = () => AbortSignal.timeout(1000);
/** No ambient keys: tests must not depend on the machine running them. */
const env = {};
const questions: Questions = {
  coordinator: {
    type: "choice",
    instructions: "Choose a coordinator.",
    criteria: { none: "No answer needed.", "bot-a": "Bot A answers." },
  },
  "collaborator:bot-a": { type: "noul", instructions: "Does Bot A help?" },
};
const answers = {
  coordinator: { type: "choice", choice: "bot-a", confidence: 0.9, probabilities: { "bot-a": 0.9, none: 0.1 } },
  "collaborator:bot-a": { type: "noul", noul: 0.2 },
};

test("a caller's questions and state reach Jev unchanged, and every answer comes back", async () => {
  const bodies: { state: string; questions: unknown }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init!.body)));
    return Response.json({ answers: { ...answers, extra: { type: "noul", noul: 1 } } });
  });
  const result = await askSystemOne({ zenApiKey: "k" }, { state: { message: "hi" }, questions }, signal(), env);
  assert.equal(result.via, "OpenCode Zen");
  assert.deepEqual(result.answers, answers, "only the questions asked are returned");
  assert.deepEqual(bodies[0]!.questions, questions);
  assert.deepEqual(JSON.parse(bodies[0]!.state), { message: "hi" });
});

test("an answer outside a choice's options, or a missing one, moves to the next provider", async () => {
  const replies = [
    { answers: { ...answers, coordinator: { ...answers.coordinator, choice: "bot-z" } } },
    { answers: { coordinator: answers.coordinator } },
  ];
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(replies.shift()));
  await assert.rejects(
    askSystemOne({ typesafeApiKey: "a", zenApiKey: "b" }, { state: {}, questions }, signal(), env),
    /TypeSafe returned an unknown decision option\. OpenCode Zen omitted a required decision\./,
  );
});

test("no provider is unavailable, which callers treat as expected", async () => {
  const failure = askSystemOne({}, { state: {}, questions }, signal(), env);
  await assert.rejects(failure, JevUnavailableError);
  await assert.rejects(failure, UnavailableError);
});

test("the public contract bounds what other plugins can send", () => {
  const ask = publicContract["systemOne.ask"].input;
  assert.equal(ask.safeParse({ caller: "bot-teams", state: { a: 1 }, questions }).success, true);
  assert.equal(ask.safeParse({ caller: "bot-teams", state: "x".repeat(70_000), questions }).success, false);
  assert.equal(ask.safeParse({ caller: "bot-teams", state: {}, questions: {} }).success, false);
  const oneOption = { q: { type: "choice", instructions: "Pick.", criteria: { only: "The only one." } } };
  assert.equal(ask.safeParse({ caller: "bot-teams", state: {}, questions: oneOption }).success, false);
  const model = publicContract["model.ask"].input;
  const request = { caller: "bot-teams", requestId: "msg_1", hostId: "host_1", prompt: "Classify.", providerId: null };
  assert.equal(model.safeParse(request).success, true);
  assert.equal(model.safeParse({ ...request, prompt: "" }).success, false);
  assert.equal(model.safeParse({ ...request, projectId: "proj_1" }).success, false);
});
