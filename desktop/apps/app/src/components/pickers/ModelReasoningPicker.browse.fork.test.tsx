// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AvailableModel, ReasoningLevel } from "@bb/domain";
import { makeProviderInfo } from "@bb/test-helpers/domain-fixtures";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { systemExecutionOptionsQueryKey } from "@/hooks/queries/query-keys";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { ModelReasoningPicker } from "./ModelReasoningPicker";
import { ModelReasoningMenu } from "./ModelReasoningMenuSplit";
import type { PickerOption } from "./OptionPicker";
import type { ProviderPickerOption } from "./model-brand-prefix";

vi.mock("@/lib/sdk", () => ({
  sdk: {
    system: {
      executionOptions: vi.fn(() => new Promise<never>(() => undefined)),
    },
  },
}));

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandContext: () => undefined,
  useAppCommandHandler: () => undefined,
  useIndexedAppCommandHandlers: () => undefined,
  useAppCommandShortcut: () => null,
  useIsAppCommandModifierHeld: () => false,
}));

const providerOptions: readonly ProviderPickerOption[] = [
  { value: "codex", label: "Codex", brandPrefix: "GPT-" },
  { value: "claude-code", label: "Claude Code", brandPrefix: "Claude " },
];

const reasoningOptions: readonly PickerOption<ReasoningLevel>[] = [
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

function claudeModel(value: string, label: string): AvailableModel {
  return {
    id: value,
    model: value,
    displayName: label,
    description: "",
    reasoningDiscovery: "known" as const,
    supportedReasoningEfforts: [
      { reasoningEffort: "medium", description: "Medium" },
    ],
    defaultReasoningEffort: "medium",
    isDefault: value === "claude-opus-4-7",
  };
}

function renderPicker() {
  const onSelectedProviderChange = vi.fn();
  const onModelChange = vi.fn();
  const onReasoningChange = vi.fn();
  const { queryClient, wrapper } = createQueryClientTestHarness();
  queryClient.setQueryData(
    systemExecutionOptionsQueryKey({
      environmentId: null,
      hostId: null,
      providerId: "claude-code",
    }),
    {
      providers: [makeProviderInfo({ id: "claude-code" })],
      models: [
        claudeModel("claude-opus-4-7", "Claude Opus 4.7"),
        claudeModel("claude-sonnet-4-7", "Claude Sonnet 4.7"),
      ],
      selectedOnlyModels: [],
      permissionCeiling: "full",
      modelLoadError: null,
    },
  );
  render(
    <div data-app-composer>
      <ModelReasoningPicker
        providerOptions={providerOptions}
        selectedProviderId="codex"
        onSelectedProviderChange={onSelectedProviderChange}
        hasMultipleProviders
        modelValue="gpt-5.5"
        modelOptions={[{ value: "gpt-5.5", label: "GPT-5.5" }]}
        moreModelOptions={[]}
        modelIsLoading={false}
        modelLoadError={null}
        onModelChange={onModelChange}
        reasoningValue="medium"
        reasoningOptions={reasoningOptions}
        onReasoningChange={onReasoningChange}
        serviceTierValue={undefined}
        serviceTierOptions={[]}
        onServiceTierChange={vi.fn()}
        modal={false}
      />
    </div>,
    { wrapper },
  );
  return { onSelectedProviderChange, onModelChange, onReasoningChange };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("provider tabs only browse", () => {
  beforeAll(() => ModelReasoningMenu.preload());

  it("shows a provider's models on a tab click without changing the selection", async () => {
    const { onSelectedProviderChange, onModelChange, onReasoningChange } =
      renderPicker();
    fireEvent.click(
      screen.getByRole("button", { name: "Provider, model and reasoning" }),
    );
    fireEvent.click(screen.getByTitle("Claude Code"));

    expect(await screen.findByText("Opus 4.7")).not.toBeNull();
    expect(onSelectedProviderChange).not.toHaveBeenCalled();
    expect(onModelChange).not.toHaveBeenCalled();
    expect(onReasoningChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTitle("Codex"));
    expect(onSelectedProviderChange).not.toHaveBeenCalled();
  });

  it("selects the provider together with the model picked from its tab", async () => {
    const { onSelectedProviderChange, onModelChange } = renderPicker();
    fireEvent.click(
      screen.getByRole("button", { name: "Provider, model and reasoning" }),
    );
    fireEvent.click(screen.getByTitle("Claude Code"));
    fireEvent.click(await screen.findByText("Sonnet 4.7"));

    expect(onSelectedProviderChange).toHaveBeenCalledTimes(1);
    expect(onSelectedProviderChange).toHaveBeenCalledWith("claude-code");
    expect(onModelChange).toHaveBeenCalledWith("claude-sonnet-4-7");
    expect(onSelectedProviderChange.mock.invocationCallOrder[0]).toBeLessThan(
      onModelChange.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("keeps the selection when the picker closes after browsing", async () => {
    const { onSelectedProviderChange, onModelChange } = renderPicker();
    fireEvent.click(
      screen.getByRole("button", { name: "Provider, model and reasoning" }),
    );
    fireEvent.click(screen.getByTitle("Claude Code"));
    expect(await screen.findByText("Opus 4.7")).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });

    expect(onSelectedProviderChange).not.toHaveBeenCalled();
    expect(onModelChange).not.toHaveBeenCalled();
  });
});
