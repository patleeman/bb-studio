import { test } from "vitest";
import assert from "node:assert/strict";
import {
  selectJevBots,
  selectJevActions,
  classifyJevReturn,
  jevRoutingRequest,
} from "../jev";
import { botSchema, messageSchema } from "../contract";
import { selectBots } from "../smart-router";
import { DecisionsUnavailableError, decisionsClient, type JevAsk } from "@bb-studio/kit/decisions";

const bots = ["Atlas", "Scribe"].map((name, index) =>
  botSchema.parse({
    id: `bot_${String(index + 1).padStart(16, "0")}`,
    name,
    handle: name.toLowerCase(),
    home: `/tmp/jev-${name}`,
    projectId: "p",
    hostId: "h",
    createdAt: 1,
    updatedAt: 1,
    lastWakeAt: 0,
    error: null,
  }),
);
const message = messageSchema.parse({
  id: "m",
  roomId: "r",
  runId: "m",
  botId: null,
  speaker: "Owner",
  text: "Why PostgreSQL instead of SQLite?",
  createdAt: 1,
});
const tasks = bots.map((bot) => ({
  botId: bot.id,
  busy: true,
  task: "Implement storage",
  threadId: "t",
}));
/** Stands in for Studio Decisions: records each question set and answers with `reply`. */
function jev(reply: (state: any, questions: Record<string, unknown>) => unknown) {
  const calls: { state: any; questions: Record<string, unknown> }[] = [];
  const ask: JevAsk = async (state, questions, signal) => {
    signal.throwIfAborted();
    calls.push({ state, questions });
    return reply(state, questions) as never;
  };
  return { calls, config: { ask } };
}
const noModel = async () => {
  throw new Error("The providers engine must not run.");
};
const choice = (value: string, confidence = 1) => ({
  type: "choice",
  choice: value,
  confidence,
  probabilities: { [value]: 1 },
});
const routeAnswers = (coordinatorId: string, execution: "serialized" | "parallel", collaborators: string[] = [], actions: Record<string, string> = {}) => ({
  coordinator: choice(coordinatorId),
  execution: choice(execution),
  ...Object.fromEntries(bots.flatMap((bot) => [
    [`collaborator:${bot.id}`, choice(collaborators.includes(bot.id) ? "yes" : "no")],
    [`action:${bot.id}`, choice(actions[bot.id] ?? "followup")],
  ])),
});

test("Jev batches all recipients and actions into one Studio Decisions call", async () => {
  const { calls, config } = jev(() => routeAnswers(bots[0]!.id, "serialized", [], { [bots[0]!.id]: "fork" }));
  const result = await selectBots(
    { ...config, routingEngine: "jev", model: noModel },
    "h",
    "codex",
    message,
    [],
    bots,
    new AbortController().signal,
    tasks,
  );
  assert.deepEqual(result, { coordinatorId: bots[0]!.id, collaboratorIds: [], executionMode: "serialized", finalizerId: bots[0]!.id, routes: [{ botId: bots[0]!.id, action: "fork" }], source: "jev" });
  assert.equal(calls.length, 1);
  assert.equal(Object.keys(calls[0]!.questions).length, 6);
  assert.equal(calls[0]!.state.message.text, message.text);
});

test("Jev distinguishes work with a helper from each bot weighing in", async () => {
  const named = bots.map((bot, i) => ({ ...bot, name: ["News Desk", "Secretary"][i]!, handle: ["news-desk", "secretary"][i]! }));
  const { calls, config } = jev(() =>
    routeAnswers(named[0]!.id, calls.length === 2 ? "parallel" : "serialized", [named[1]!.id]),
  );
  const serialMessage = { ...message, text: "@news-desk work with @secretary" };
  const parallelMessage = { ...message, text: "@news-desk and @secretary each weigh in" };
  const candidateIds = named.map((bot) => bot.id);
  const serial = await selectJevBots(config, serialMessage, [], named, new AbortController().signal, [], candidateIds);
  const parallel = await selectJevBots(config, parallelMessage, [], named, new AbortController().signal, [], candidateIds);
  assert.equal(serial.coordinatorId, named[0]!.id);
  assert.deepEqual(serial.collaboratorIds, [named[1]!.id]);
  assert.equal(serial.executionMode, "serialized");
  assert.deepEqual(serial.routes.map((route) => route.botId), [named[0]!.id]);
  assert.equal(parallel.executionMode, "parallel");
  assert.deepEqual(parallel.routes.map((route) => route.botId), candidateIds);
  assert.equal(parallel.finalizerId, named[0]!.id);
  assert.deepEqual(calls[0]!.state.message.candidateBotIds, candidateIds);
});

test("Directed Jev classification keeps every literal recipient", async () => {
  const { config } = jev(() => ({
    [bots[0]!.id]: choice("steer", 0.9),
    [bots[1]!.id]: choice("fork", 0.2),
  }));
  assert.deepEqual(
    await selectJevActions(config, message, [], bots, new AbortController().signal, tasks, bots.map((bot) => bot.id)),
    [{ botId: bots[0]!.id, action: "steer" }, { botId: bots[1]!.id, action: "followup" }],
  );
});

test("uncertain Jev steer and fork decisions default to follow-up", async () => {
  const { config } = jev(() => ({
    ...routeAnswers(bots[0]!.id, "parallel", [bots[1]!.id]),
    [`action:${bots[0]!.id}`]: choice("steer", 0.3),
    [`action:${bots[1]!.id}`]: choice("fork", 0.6),
  }));
  assert.deepEqual(
    await selectJevBots(config, message, [], bots, new AbortController().signal, tasks),
    { coordinatorId: bots[0]!.id, collaboratorIds: [bots[1]!.id], executionMode: "parallel", finalizerId: bots[0]!.id, routes: bots.map((bot) => ({ botId: bot.id, action: "followup" })), source: "jev" },
  );
});

test("uncertain parallel work stays with one coordinator", async () => {
  const { config } = jev(() => ({
    ...routeAnswers(bots[0]!.id, "parallel", [bots[1]!.id]),
    execution: choice("parallel", 0.3),
  }));
  const plan = await selectJevBots(config, message, [], bots, new AbortController().signal, [], bots.map((bot) => bot.id));
  assert.equal(plan.executionMode, "serialized");
  assert.deepEqual(plan.collaboratorIds, [bots[1]!.id]);
  assert.deepEqual(plan.routes.map((route) => route.botId), [bots[0]!.id]);
});

test("Jev receives prior bot identity and safely continues an uncertain follow-up", async () => {
  const previous = messageSchema.parse({
    ...message,
    id: "previous",
    botId: bots[0]!.id,
    speaker: bots[0]!.name,
    text: "The database query failed in the sandbox.",
  });
  const followup = { ...message, id: "followup", text: "You were querying the db directly??" };
  const { calls, config } = jev(() => ({
    ...routeAnswers(bots[1]!.id, "parallel", [bots[0]!.id]),
    coordinator: choice(bots[1]!.id, 0.4),
  }));
  const plan = await selectJevBots(config, followup, [previous], bots, new AbortController().signal);
  assert.equal(calls[0]?.state.recent[0]?.botId, bots[0]!.id);
  assert.equal(calls[0]?.state.message.continuationCandidateId, bots[0]!.id);
  assert.deepEqual(plan, {
    coordinatorId: bots[0]!.id,
    collaboratorIds: [],
    executionMode: "serialized",
    finalizerId: bots[0]!.id,
    routes: [{ botId: bots[0]!.id, action: "followup" }],
    source: "fallback",
  });
  await assert.rejects(
    selectJevBots(config, { ...followup, text: "Review the deployment schedule" }, [previous], bots, new AbortController().signal),
    /uncertain about the coordinator/,
  );
});

test("explicit mentions become candidates and idle bots cannot be steered", async () => {
  const request = jevRoutingRequest(message, [], bots, [], [bots[1]!.id]);
  assert.deepEqual(Object.keys(request.questions), ["coordinator", "execution", `collaborator:${bots[1]!.id}`, `action:${bots[1]!.id}`]);
  const question = request.questions[`action:${bots[1]!.id}`]!;
  assert.deepEqual(
    question.type === "choice" && Object.keys(question.criteria),
    ["skip", "followup"],
  );
});

test("routing refuses missing answers and answer types", async () => {
  const replies = [{}, { coordinator: { type: "noul", noul: 0.9 } }];
  const { config } = jev(() => replies.shift());
  for (let i = 0; i < 2; i++)
    await assert.rejects(
      selectJevBots(config, message, [], [bots[0]!], new AbortController().signal),
      /invalid routing decision/,
    );
});

test("Jev failures surface without starting the providers engine", async () => {
  let modelCalls = 0;
  await assert.rejects(
    selectBots(
      {
        ask: async () => {
          throw new Error("TypeSafe rejected the API key (HTTP 401).");
        },
        routingEngine: "jev",
        model: async () => {
          modelCalls++;
          return null;
        },
      },
      "h",
      "codex",
      message,
      [],
      bots,
      new AbortController().signal,
    ),
    /HTTP 401/,
  );
  assert.equal(modelCalls, 0);
});

test("Jev cancellation reaches the Studio Decisions call", async () => {
  const { config } = jev(() => new Promise(() => {}));
  const controller = new AbortController();
  const waiting: JevAsk = (state, questions, signal) =>
    new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  const pending = selectJevBots({ ...config, ask: waiting }, message, [], bots, controller.signal);
  controller.abort(new Error("Stopped"));
  await assert.rejects(pending, /Stopped/);
});

test("Jev returns require both a real request and useful settled results", async () => {
  const probabilities = [
    [0.99, 0.98],
    [0.99, 0.05],
    [0.02, 0.99],
  ];
  const { config } = jev(() => {
    const values = probabilities.shift()!;
    return {
      request: { type: "noul", noul: values[0] },
      result: { type: "noul", noul: values[1] },
    };
  });
  for (const expected of [true, false, false])
    assert.equal(
      await classifyJevReturn(config, { requests: [], results: [] }, new AbortController().signal),
      expected,
    );
});

test("Jev rejects unknown required recipients before asking", async () => {
  const { calls, config } = jev(() => ({}));
  await assert.rejects(
    selectJevBots(config, message, [], bots, new AbortController().signal, [], ["unknown"]),
    /outside the roster/,
  );
  assert.equal(calls.length, 0);
});

test("the providers engine runs the routing prompt through Studio Decisions' model", async () => {
  const requests: unknown[] = [];
  const plan = await selectBots(
    {
      ask: async () => {
        throw new Error("The Jev engine must not run.");
      },
      routingEngine: "providers",
      model: async (request) => {
        requests.push(request);
        return JSON.stringify({ coordinatorId: bots[0]!.id, collaboratorIds: [], executionMode: "serialized", routes: [{ botId: bots[0]!.id, action: "followup" }] });
      },
    },
    "h",
    "codex",
    message,
    [],
    bots,
    new AbortController().signal,
  );
  assert.equal((plan as { coordinatorId: string }).coordinatorId, bots[0]!.id);
  assert.deepEqual(Object.keys(requests[0] as object), ["requestId", "hostId", "providerId", "prompt"]);
  assert.deepEqual({ ...(requests[0] as object), prompt: undefined }, { requestId: message.id, hostId: "h", providerId: "codex", prompt: undefined });
  await assert.rejects(
    selectBots(
      { ask: noModel, routingEngine: "providers", model: async () => "sure, wake Atlas" },
      "h",
      null,
      message,
      [],
      bots,
      new AbortController().signal,
    ),
    /Could not choose a bot/,
  );
});

function fakeBb(callRpc: (args: { pluginId: string; method: string; input: any; outputSchema: { parse(value: unknown): unknown } }) => Promise<unknown>) {
  return { sdk: { plugins: { callRpc } } } as never;
}

test("the Studio Decisions client names Studio Teams and checks each reply", async () => {
  const seen: { pluginId: string; method: string; input: any }[] = [];
  const client = decisionsClient(
    fakeBb(async (args) => {
      seen.push(args);
      return args.outputSchema.parse(
        args.method === "systemOne.ask"
          ? { ok: true, answers: { coordinator: choice("none") }, via: "TypeSafe", ms: 3 }
          : { ok: true, text: "{}", via: "codex", ms: 9 },
      );
    }),
  );
  const signal = new AbortController().signal;
  assert.deepEqual(await client.jev({ a: 1 }, { coordinator: { type: "noul", instructions: "?" } }, signal), {
    coordinator: choice("none"),
  });
  assert.equal(await client.model({ requestId: "m", hostId: "h", providerId: null, prompt: "Classify." }, signal), "{}");
  assert.deepEqual(
    seen.map(({ pluginId, method, input }) => [pluginId, method, input.caller]),
    [
      ["smart-decisions", "systemOne.ask", "bot-teams"],
      ["smart-decisions", "model.ask", "bot-teams"],
    ],
  );
  const bad = decisionsClient(
    fakeBb(async (args) => args.outputSchema.parse({ ok: true, answers: { coordinator: choice("none", 2) }, via: "x", ms: 1 })),
  );
  await assert.rejects(bad.jev({}, {}, signal), DecisionsUnavailableError, "an out-of-range confidence is refused");
});

test("a missing or unconfigured Studio Decisions says how to set it up", async () => {
  const signal = new AbortController().signal;
  const missing = decisionsClient(
    fakeBb(async () => {
      throw new Error("Plugin smart-decisions is not installed.");
    }),
  );
  await assert.rejects(missing.jev({}, {}, signal), (error: Error) =>
    error instanceof DecisionsUnavailableError && /Install and enable Studio Decisions/.test(error.message),
  );
  const unconfigured = decisionsClient(
    fakeBb(async (args) => args.outputSchema.parse({ ok: false, unavailable: true, error: "No Jev provider is configured." })),
  );
  await assert.rejects(unconfigured.jev({}, {}, signal), (error: Error) =>
    error instanceof DecisionsUnavailableError && /No Jev provider is configured\. Set up a Jev provider or fallback model in Studio Decisions settings\./.test(error.message),
  );
  const failing = decisionsClient(
    fakeBb(async (args) => args.outputSchema.parse({ ok: false, unavailable: false, error: "TypeSafe request failed (HTTP 500)." })),
  );
  await assert.rejects(failing.model({ requestId: "m", hostId: "h", providerId: null, prompt: "x" }, signal), (error: Error) =>
    !(error instanceof DecisionsUnavailableError) && /HTTP 500/.test(error.message),
  );
});
