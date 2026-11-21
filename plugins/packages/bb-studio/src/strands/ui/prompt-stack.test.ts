import { afterEach, expect, it, vi } from "vitest";
import { hostContextSegments, promptStackSource, resetPromptStackForTests } from "./prompt-stack";

afterEach(() => { resetPromptStackForTests(); vi.unstubAllGlobals(); });

it("answers nothing for a thread no box reported, and the same array while nothing changed", () => {
  const first = promptStackSource.get("thr_plain");
  expect(first).toEqual([]);
  expect(promptStackSource.get("thr_plain")).toBe(first);
});

it("finds the fork's context row component on the plugin runtime, and none on an older BB", () => {
  expect(hostContextSegments()).toBeNull();
  const Segments = () => null;
  vi.stubGlobal("__bbPluginRuntime", { pluginSdkApp: { experimental_ThreadContextSegments: Segments } });
  expect(hostContextSegments()).toBe(Segments);
});
