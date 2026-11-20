import { describe, expect, it, vi } from "vitest";

const runTextAiTask = vi.hoisted(() => vi.fn());
vi.mock("../../src/services/ai/ai-tasks.js", () => ({ runTextAiTask }));
const { completeTextForPlugin, TEXT_COMPLETION_MAX_PROMPT } = await import(
  "../../src/services/ai/plugin-text-completion.fork.js"
);

const deps = {} as never;

describe("plugin text completion", () => {
  it("runs bb's title task: one tool-less call on the user's title service, bounded", async () => {
    runTextAiTask.mockResolvedValueOnce({
      ok: true,
      value: "coding",
      service: { displayName: "Codex" },
      durationMs: 42,
    });
    const result = await completeTextForPlugin(
      "studio",
      { prompt: ` ${"x".repeat(40_000)} `, timeoutMs: 99_999 },
      deps,
    );
    expect(result).toEqual({ ok: true, text: "coding", service: "Codex", ms: 42 });
    const [, args] = runTextAiTask.mock.calls[0]!;
    expect(args).toMatchObject({
      task: "thread-title",
      timeoutMs: 8_000,
      logContext: { pluginId: "studio" },
    });
    expect(args.prompt).toHaveLength(TEXT_COMPLETION_MAX_PROMPT);
  });

  it("passes failures through and refuses an empty prompt or a missing service", async () => {
    runTextAiTask.mockResolvedValueOnce({
      ok: false,
      reason: "off",
      message: "Turned off in Settings → AI services",
      durationMs: 1,
    });
    expect(
      await completeTextForPlugin("studio", { prompt: "x", timeoutMs: 10 }, deps),
    ).toEqual({ ok: false, reason: "off", message: "Turned off in Settings → AI services", ms: 1 });
    expect(runTextAiTask.mock.calls.at(-1)![1].timeoutMs).toBe(500);
    expect(await completeTextForPlugin("studio", { prompt: "  " }, deps)).toMatchObject({ ok: false, reason: "unavailable" });
    expect(await completeTextForPlugin("studio", { prompt: "x" }, null)).toMatchObject({ ok: false, reason: "unavailable" });
  });
});
