import type { PluginComposerApi, PluginComposerScope } from "@get-bb/plugin-sdk/app";
import { describe, expect, it } from "vitest";
import { createExcalidrawComposerCustomization } from "./composer-registration";

describe("Excalidraw composer registration", () => {
  it("is discoverable but disabled until a thread exists", () => {
    const customization = createExcalidrawComposerCustomization(() => undefined);
    expect(customization.scopes).toEqual(["thread", "new-thread"]);

    const item = customization.plusMenu?.[0];
    expect(item?.label).toBe("Drawing");
    expect(typeof item?.disabled).toBe("function");
    if (typeof item?.disabled !== "function") return;

    const composer = (scope: PluginComposerScope) => ({ scope }) as PluginComposerApi;
    expect(item.disabled(composer({ kind: "new-thread", projectId: null }))).toBe(true);
    expect(item.disabled(composer({ kind: "thread", threadId: "thread-1" }))).toBe(false);
  });
});
