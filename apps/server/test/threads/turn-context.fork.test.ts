import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeClientTurnRequestIdNumber } from "@bb/domain";
import {
  buildExecutionOptions,
  buildThreadStartCommand,
  prepareTurnSubmitCommandPayload,
} from "../../src/services/threads/thread-commands.js";
import { forkPluginHooks } from "../../src/services/threads/turn-classifiers.fork.js";
import {
  collectTurnContext,
  registerTurnContextProvider,
  TURN_CONTEXT_MAX_CHARS,
  TURN_CONTEXT_TIMEOUT_MS,
  withTurnContext,
} from "../../src/services/threads/turn-context.fork.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const disposers: Array<() => void> = [];

function provide(
  pluginId: string,
  provider: Parameters<typeof registerTurnContextProvider>[1],
) {
  disposers.push(registerTurnContextProvider(pluginId, provider));
}

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.useRealTimers();
});

function texts(items: Awaited<ReturnType<typeof collectTurnContext>>) {
  return items.map((item) => {
    expect(item).toMatchObject({ type: "text", visibility: "agent-only" });
    return item.type === "text" ? item.text : "";
  });
}

describe("turn context providers", () => {
  it("asks every plugin with the thread id and labels each answer, in plugin-id order", async () => {
    const seen: string[] = [];
    provide("zeta", ({ threadId }) => {
      seen.push(`zeta:${threadId}`);
      return Promise.resolve("Two workers running.");
    });
    provide("alpha", ({ threadId }) => {
      seen.push(`alpha:${threadId}`);
      return "Main is waiting on you.";
    });
    provide("empty", () => "   ");
    provide("nothing", () => null);
    expect(texts(await collectTurnContext("thr_1"))).toEqual([
      "Context from the alpha plugin at the start of this turn:\n\nMain is waiting on you.",
      "Context from the zeta plugin at the start of this turn:\n\nTwo workers running.",
    ]);
    expect(seen.sort()).toEqual(["alpha:thr_1", "zeta:thr_1"]);
  });

  it("ignores a provider that throws, rejects, or answers with something other than text", async () => {
    provide("throws", () => {
      throw new Error("boom");
    });
    provide("rejects", () => Promise.reject(new Error("boom")));
    provide("number", () => 42 as unknown as string);
    provide("works", () => "Still here.");
    expect(texts(await collectTurnContext("thr_1"))).toEqual([
      "Context from the works plugin at the start of this turn:\n\nStill here.",
    ]);
  });

  it("caps each answer's length", async () => {
    provide("long", () => "x".repeat(TURN_CONTEXT_MAX_CHARS * 2));
    const [text] = texts(await collectTurnContext("thr_1"));
    const body = text!.split("\n\n")[1]!;
    expect(body).toHaveLength(TURN_CONTEXT_MAX_CHARS);
    expect(body.endsWith("…")).toBe(true);
  });

  it("waits at most the timeout and drops late answers", async () => {
    vi.useFakeTimers();
    provide(
      "slow",
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve("late"), TURN_CONTEXT_TIMEOUT_MS * 4),
        ),
    );
    provide("fast", () => "on time");
    const pending = collectTurnContext("thr_1");
    await vi.advanceTimersByTimeAsync(TURN_CONTEXT_TIMEOUT_MS);
    expect(texts(await pending)).toEqual([
      "Context from the fast plugin at the start of this turn:\n\non time",
    ]);
  });

  it("appends to the input and to the last input group, and leaves steers and empty input alone", async () => {
    provide("studio", () => "digest");
    const first = textInput("first");
    const second = textInput("second");
    const withGroups = await withTurnContext("thr_1", {
      input: [...first, ...second],
      inputGroups: [first, second],
    });
    expect(withGroups.input).toHaveLength(3);
    expect(withGroups.inputGroups?.[0]).toEqual(first);
    expect(withGroups.inputGroups?.[1]).toHaveLength(2);
    expect(withGroups.inputGroups?.[1]?.[1]).toBe(withGroups.input[2]);

    const steer = { input: textInput("steer") };
    expect(await withTurnContext("thr_1", steer, false)).toBe(steer);
    const empty = { input: [] };
    expect(await withTurnContext("thr_1", empty)).toBe(empty);
  });

  it("registers through bb.experimental_hooks, replaces per plugin, and stops on dispose", async () => {
    const disposeHooks: Array<() => void | Promise<void>> = [];
    const hooks = forkPluginHooks({
      pluginId: "studio",
      assertLive: () => {},
      disposeHooks,
      db: {} as never,
    });
    expect(() => hooks.experimental_turnContext("nope" as never)).toThrowError(
      "experimental_turnContext expects a function",
    );
    hooks.experimental_turnContext(() => "first");
    hooks.experimental_turnContext(() => "second");
    expect(texts(await collectTurnContext("thr_1"))).toEqual([
      "Context from the studio plugin at the start of this turn:\n\nsecond",
    ]);
    for (const dispose of disposeHooks) await dispose();
    expect(await collectTurnContext("thr_1")).toEqual([]);
  });

  it("reaches the thread.start command and a turn.submit that starts a turn, not a steer", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/turn-context",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/turn-context",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });
      const asked: string[] = [];
      provide("studio", ({ threadId }) => {
        asked.push(threadId);
        return "Elsewhere: two workers.";
      });
      const execution = await buildExecutionOptions(
        harness.deps,
        { model: "test-model", permissionMode: "accept-edits" },
        { threadId: thread.id },
      );
      const start = await buildThreadStartCommand(harness.deps, {
        environment,
        execution,
        fork: null,
        permissionEscalation: "ask",
        input: textInput("hello"),
        projectId: project.id,
        providerId: thread.providerId,
        requestId: encodeClientTurnRequestIdNumber({ value: 1 }),
        syncGeneratedTitle: false,
        thread,
      });
      const submit = (mode: "start" | "steer") =>
        prepareTurnSubmitCommandPayload(harness.deps, {
          environment,
          execution,
          permissionEscalation: "ask",
          input: textInput("continue"),
          providerThreadId: "provider-session",
          target:
            mode === "start" ? { mode } : { mode, expectedTurnId: "turn_1" },
          thread,
        });
      const next = await submit("start");
      const steer = await submit("steer");
      const digest = {
        type: "text",
        text: "Context from the studio plugin at the start of this turn:\n\nElsewhere: two workers.",
        visibility: "agent-only",
      };
      expect(start.input).toHaveLength(2);
      expect(start.input[1]).toMatchObject(digest);
      expect(next.input).toHaveLength(2);
      expect(next.input[1]).toMatchObject(digest);
      expect(steer.input).toHaveLength(1);
      expect(asked).toEqual([thread.id, thread.id]);
    });
  });
});
