// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { systemExecutionOptionsQueryKey } from "@/hooks/queries/query-keys";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  forgetRememberedProviderModels,
  rememberedProviderModel,
  useRememberedProviderModel,
} from "./rememberedProviderModel.fork";

function catalog(models: string[]) {
  return {
    providers: [],
    models: models.map((model) => ({ id: model, model, displayName: model })),
    selectedOnlyModels: [],
    permissionCeiling: "full",
    modelLoadError: null,
  };
}

function setup() {
  const { queryClient, wrapper } = createQueryClientTestHarness();
  const key = (providerId: string) =>
    systemExecutionOptionsQueryKey({ environmentId: null, hostId: null, providerId });
  queryClient.setQueryData(key("claude-code"), catalog(["claude-sonnet", "claude-opus"]));
  queryClient.setQueryData(key("opencode"), catalog(["claude-sonnet", "gpt-x"]));
  queryClient.setQueryData(key("codex"), catalog(["gpt-5.5"]));
  const hook = renderHook(
    ({ providerId, model }: { providerId: string; model: string }) =>
      useRememberedProviderModel(null, providerId, model),
    { wrapper, initialProps: { providerId: "claude-code", model: "claude-sonnet" } },
  );
  return hook;
}

afterEach(() => {
  forgetRememberedProviderModels();
});

describe("the model remembered for each provider", () => {
  it("is saved under the provider whose catalog has it", () => {
    setup();
    expect(rememberedProviderModel("claude-code", "")).toBe("claude-sonnet");
  });

  it("is not saved under a provider whose catalog lacks it", () => {
    const hook = setup();
    hook.rerender({ providerId: "codex", model: "claude-sonnet" });
    expect(rememberedProviderModel("codex", "")).toBe("");
  });

  it("skips the render where only the provider has switched, even when both share the model id", () => {
    const hook = setup();
    hook.rerender({ providerId: "opencode", model: "claude-sonnet" });
    expect(rememberedProviderModel("opencode", "stored")).toBe("stored");
    hook.rerender({ providerId: "opencode", model: "gpt-x" });
    expect(rememberedProviderModel("opencode", "stored")).toBe("gpt-x");
    expect(rememberedProviderModel("claude-code", "")).toBe("claude-sonnet");
  });
});
