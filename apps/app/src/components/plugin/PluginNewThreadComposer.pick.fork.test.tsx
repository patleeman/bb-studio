// @vitest-environment jsdom

import { useEffect, useState, type ReactNode } from "react";
import { Provider } from "jotai";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  defaultAppSettings,
  
  type ThreadListEntry,
  type ThreadSessionOption,
} from "@bb/domain";
import {
  act,
  cleanup,
  
  render as renderWithoutQueryClient,
  
  waitFor,
} from "@testing-library/react";
import {
  
  MemoryRouter,
  
} from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  
  
  PluginEnvironmentProviderInputsProps,
} from "@get-bb/plugin-sdk";
import type {
  SystemEnvironmentProvider,
  SystemMachineProvider,
} from "@bb/server-contract";
import {
  NewThreadComposer,
  
} from "@/components/promptbox/NewThreadComposer";
import { setComposerSelectionSettleTimeoutForTest } from "@/components/promptbox/composer-selection-settle";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { getPromptDraftAccessor } from "@/hooks/usePromptDraftStorage";
import { makeProjectWithThreadsResponse } from "@/test/fixtures/projects";
import { resetFixedPanelTabsStateForTest } from "@/lib/fixed-panel-tabs";
import { useFixedPanelTabsState } from "@/lib/fixed-panel-tabs";

function render(element: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithoutQueryClient(element, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

const mocks = vi.hoisted(() => ({
  unknownReasoning: false,
  promptBoxProps: [] as Array<Record<string, any>>,
  copyAttachments: vi.fn(),
  uploadAttachment: vi.fn(),
  projectThreads: [] as ThreadListEntry[],
  sidebarNavigationSettled: true,
  sidebarNavigationReplayed: false,
  extraProjects: [] as Array<Record<string, unknown>>,
  promptHistoryQueryOptions: [] as Array<{ enabled?: boolean } | undefined>,
  environmentProviders: [] as unknown[],
  closeTerminal: vi.fn(() => Promise.resolve()),
  plugins: [] as unknown[],
  serverAccessReady: true,
  machineProviders: [] as SystemMachineProvider[],
  modelsLoading: false,
  permissionCeiling: undefined as "accept-edits" | "auto" | "full" | undefined,
  modelSessionOptions: undefined as ThreadSessionOption[] | undefined,
  openCreateDialogThen: vi.fn(),
}));

vi.mock("@/views/RootComposePanelCommandHandlers", () => ({
  RootComposePanelCommandHandlers: ({
    onClose,
  }: {
    onClose: () => boolean;
  }) => {
    const { secondary } = useFixedPanelTabsState("root-compose", null);
    const active = secondary.tabs.find(
      (tab) => tab.id === secondary.activeTabId,
    );
    return (
      <button
        data-active-detail={
          active?.kind === "plugin-detail" ? active.detailKey : ""
        }
        onClick={onClose}
      >
        Close panel command
      </button>
    );
  },
}));

vi.mock("@/components/secondary-panel/SecondaryPanelLayout", () => ({
  SecondaryPanelLayout: ({ main }: { main: ReactNode }) => main,
}));

vi.mock("@/hooks/queries/thread-terminal-queries", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/hooks/queries/thread-terminal-queries")
    >();
  return {
    ...actual,
    useTerminals: () => ({ data: undefined }),
    useEnvironmentTerminals: () => ({ data: undefined }),
    useCloseTerminal: () => ({ mutateAsync: mocks.closeTerminal }),
  };
});

vi.mock("@/components/promptbox/NewThreadPromptBox", () => ({
  NewThreadPromptBox: (props: Record<string, any>) => {
    mocks.promptBoxProps.push(props);
    return (
      <div data-testid="new-thread-prompt-box">
        {props.modeConfig?.banner ?? null}
        {props.modeConfig?.environmentProviderInputsSlot ?? null}
      </div>
    );
  },
}));

vi.mock("@/hooks/queries/environment-provider-queries", () => ({
  useSystemEnvironmentProviders: () => ({
    providers: mocks.environmentProviders,
  }),
}));

vi.mock("@/hooks/queries/machine-provider-queries", () => ({
  useSystemMachineProviders: () => ({ providers: mocks.machineProviders }),
}));

vi.mock("@/hooks/queries/plugin-settings-queries", () => ({
  usePluginList: () => ({ data: { plugins: mocks.plugins } }),
}));

vi.mock("@/lib/sdk", () => ({
  sdk: {
    projects: { attachments: { copy: mocks.copyAttachments } },
    system: {
      experimental_recordTelemetryEvent: vi
        .fn()
        .mockRejectedValue(new Error("Telemetry unavailable")),
    },
  },
}));

const PROJECT = makeProjectWithThreadsResponse({
  id: "proj_1",
  name: "Project One",
  defaultExecutionOptions: {
    providerId: "codex",
    model: "gpt-5.6",
    serviceTier: "default",
    reasoningLevel: "medium",
    permissionMode: "auto",
  },
  sources: [
    {
      id: "src_1",
      projectId: "proj_1",
      type: "local_path",
      hostId: "host_1",
      path: "/repo",
      isDefault: true,
      createdAt: 0,
      updatedAt: 0,
    },
    {
      id: "src_remote",
      projectId: "proj_1",
      type: "local_path",
      hostId: "host_2",
      path: "/remote-repo",
      isDefault: false,
      createdAt: 0,
      updatedAt: 0,
    },
  ],
});

const OTHER_PROJECT = makeProjectWithThreadsResponse({
  ...PROJECT,
  id: "proj_2",
  name: "Project Two",
  sources: [{ ...PROJECT.sources[0], id: "src_2", projectId: "proj_2" }],
});

vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useSidebarNavigation: () =>
    mocks.sidebarNavigationSettled
      ? {
          data: {
            sections: [],
            projects: [
              { ...PROJECT, threads: mocks.projectThreads },
              OTHER_PROJECT,
              ...mocks.extraProjects,
            ],
            personalProject: makeProjectWithThreadsResponse({
              id: "personal",
              kind: "personal",
              name: "Personal",
              sources: [],
              threads: [],
            }),
          },
          isError: false,
          isLoading: false,
          isPending: false,
          isSuccess: true,
          isPlaceholderData: mocks.sidebarNavigationReplayed,
        }
      : {
          data: undefined,
          isError: false,
          isLoading: true,
          isPending: true,
          isSuccess: false,
          isPlaceholderData: false,
        },
}));

vi.mock("@/hooks/queries/host-queries", () => ({
  useHosts: () => ({
    data: [
      { id: "host_1", name: "Machine" },
      { id: "host_2", name: "Other machine" },
    ],
  }),
  selectHosts: <T,>(hosts: T[] | undefined) => hosts ?? [],
  selectPrimaryHost: (
    hosts: Array<{ id: string }> | undefined,
    primaryHostId: string | null,
  ) => hosts?.find((host) => host.id === primaryHostId) ?? hosts?.[0] ?? null,
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemProviders: () => ({ data: undefined }),
  useSystemProviderStates: () => ({ data: undefined, isPending: false }),
  useKnownProviderModelCatalogScope: () => undefined,
  useHostProviderCliStatus: () => ({ data: undefined }),
  useSystemConfig: () => ({
    data: {
      primaryHostId: "host_1",
      generalSettings: defaultAppSettings,
      serverAccess: {
        providers: [
          {
            id: "connect",
            displayName: "bb connect",
            description: "Use a private getbb.app address.",
            pluginId: "connect",
            availability: mocks.serverAccessReady
              ? { status: "available", serverUrl: "https://sawyer.getbb.app" }
              : { status: "setup-required", message: "Pair with bb connect" },
          },
        ],
        defaultProviderId: "connect",
        effectiveUrl: "https://sawyer.getbb.app",
        urlSource: null,
      },
    },
  }),
  useSystemExecutionOptions: () =>
    mocks.modelsLoading
      ? {
          data: undefined,
          isLoading: true,
          isError: false,
          isPlaceholderData: false,
        }
      : {
          data: {
            permissionCeiling: mocks.permissionCeiling,
            providers: [
              {
                id: "codex",
                displayName: "Codex",
                logoUrl: null,
                capabilities: {
                  supportsServiceTier: false,
                  permissionModes: ["auto", "accept-edits", "full"],
                },
                composerActions: [],
              },
              {
                id: "claude-code",
                displayName: "Claude Code",
                logoUrl: null,
                capabilities: {
                  supportsServiceTier: false,
                  permissionModes: ["auto", "accept-edits", "full"],
                },
                composerActions: [],
              },
            ],
            models: [
              {
                model: "gpt-5.6",
                displayName: "GPT-5.6",
                isDefault: true,
                sessionOptions: mocks.modelSessionOptions,
                reasoningDiscovery: "known" as const,
                supportedReasoningEfforts: mocks.unknownReasoning
                  ? []
                  : [
                      { reasoningEffort: "low" },
                      { reasoningEffort: "medium" },
                      { reasoningEffort: "high" },
                    ],
              },
              {
                model: "gpt-5.6-sol",
                displayName: "GPT-5.6 Sol",
                isDefault: false,
                sessionOptions: mocks.modelSessionOptions,
                reasoningDiscovery: "known" as const,
                supportedReasoningEfforts: mocks.unknownReasoning
                  ? []
                  : [
                      { reasoningEffort: "medium" },
                      { reasoningEffort: "high" },
                    ],
              },
            ],
            selectedOnlyModels: [],
            modelLoadError: null,
          },
          isLoading: false,
          isError: false,
          isPlaceholderData: false,
        },
}));

vi.mock("@/hooks/queries/thread-panel-queries", () => ({
  useThreadStorageFiles: () => ({
    data: undefined,
    error: null,
    isLoading: false,
    refetch: vi.fn(),
  }),
  useThreadStorageFilePreview: () => ({
    data: undefined,
    error: null,
    isLoading: false,
  }),
}));

vi.mock("@/hooks/queries/project-queries", () => ({
  stripProjectThreads: (project: unknown) => project,
  useProjectPromptHistory: (
    _projectId: unknown,
    options?: { enabled?: boolean },
  ) => {
    mocks.promptHistoryQueryOptions.push(options);
    return { data: [] };
  },
  useProjectSourceBranches: () => ({
    data: {
      branches: ["main", "release"],
      branchesTruncated: false,
      checkout: { kind: "branch", branchName: "main" },
      defaultBranch: "main",
      defaultBranchRelation: null,
      hasUncommittedChanges: false,
      operation: { kind: "none" },
      originDefaultBranch: null,
      remoteBranches: [],
      remoteBranchesTruncated: false,
      selectedBranch: null,
      defaultWorktreeBaseBranch: null,
    },
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/queries/project-default-execution-options-query", () => ({
  useProjectDefaultExecutionOptions: () => ({ data: undefined }),
}));

vi.mock("@/hooks/mutations/project-mutations", () => ({
  useUploadPromptAttachment: () => ({
    mutateAsync: mocks.uploadAttachment,
    isPending: false,
  }),
}));

vi.mock("@/hooks/usePromptMentions", async () =>
  (await import("@/test/fixtures/composer-search")).fakePromptMentionsModule(),
);

vi.mock("@/hooks/useCommandSuggestions", async () =>
  (
    await import("@/test/fixtures/composer-search")
  ).fakeCommandSuggestionsModule(),
);

vi.mock("@/hooks/useQuickCreateProject", () => ({
  useQuickCreateProjectController: () => ({
    hostId: null,
    hostName: null,
    hosts: [],
    isAvailable: false,
    isCreating: false,
    openCreateDialog: vi.fn(),
    openCreateDialogThen: mocks.openCreateDialogThen,
    platform: null,
    projectPathDialog: {
      isOpen: false,
      onOpenChange: vi.fn(),
      target: null,
    },
    submitProjectPath: vi.fn(),
  }),
}));

vi.mock("@/components/dialogs/ProjectMachineSetupDialog", () => ({
  ProjectMachineSetupDialog: () => null,
}));

vi.mock("@/views/RootComposeSecondaryContent", () => ({
  useRootComposePinnedPanelToggleBoxClassName: () => "",
  RootComposeSecondaryContent: ({ children }: { children: ReactNode }) =>
    children,
}));

function latestPromptBoxProps(): Record<string, any> {
  const props = mocks.promptBoxProps.at(-1);
  expect(props).toBeDefined();
  return props as Record<string, any>;
}

const BRANCH_INPUTS_SCHEMA = {
  type: "object",
  properties: { branch: { type: "object" } },
  required: ["branch"],
};

const CHECKOUT_PROVIDER: SystemEnvironmentProvider = {
  machineProviderId: null,
  id: "project-checkout",
  displayName: "Project checkout",
  description: "Prepare a workspace for this thread.",
  icon: "Laptop",
  logoUrl: null,
  pluginId: "environment-project-checkout",
  acceptsEmptyInputs: true,
  machineAvailability: {},
  availability: null,
  requires: {
    projectCheckout: true,
    gitCheckout: false,
    gitRemote: false,
    projectless: false,
  },
  inputs: {
    type: "object",
    properties: { branch: { type: "object" }, path: { type: "string" } },
  },
};

const PERSONAL_WORKSPACE_PROVIDER: SystemEnvironmentProvider = {
  machineProviderId: null,
  id: "personal-workspace",
  displayName: "Personal workspace",
  description: "Prepare a workspace for this thread.",
  icon: "Folder",
  logoUrl: null,
  pluginId: "environment-personal-workspace",
  acceptsEmptyInputs: true,
  machineAvailability: {},
  availability: null,
  requires: {
    projectCheckout: false,
    gitCheckout: false,
    gitRemote: false,
    projectless: true,
  },
  inputs: null,
};

const MANAGED_WORKTREE_SUGAR_PROVIDER: SystemEnvironmentProvider = {
  machineProviderId: null,
  id: "git-worktree",
  displayName: "Worktree",
  description: "Prepare a workspace for this thread.",
  icon: "GitBranch",
  logoUrl: null,
  pluginId: "environment-git-worktree",
  acceptsEmptyInputs: false,
  machineAvailability: {},
  availability: null,
  requires: {
    projectCheckout: true,
    gitCheckout: true,
    gitRemote: false,
    projectless: false,
  },
  inputs: BRANCH_INPUTS_SCHEMA,
};

const EMPTY_SLOT_REGISTRATIONS = {
  homepageSections: [],
  settingsSections: [],
  navPanels: [],
  threadPanelActions: [],
  sidebarFooterActions: [],
  fileOpeners: [],
  messageDirectives: [],
};

const DEFAULT_BRANCH_INPUTS = { branch: { kind: "default" } };

function WorktreeInputsControl({
  value,
  onChange,
}: PluginEnvironmentProviderInputsProps) {
  useEffect(() => {
    if (value === null) {
      onChange({ status: "ready", value: DEFAULT_BRANCH_INPUTS });
    }
  }, [onChange, value]);
  return (
    <button
      type="button"
      data-testid="worktree-default-branch"
      onClick={() =>
        onChange({ status: "ready", value: DEFAULT_BRANCH_INPUTS })
      }
    >
      default branch
    </button>
  );
}

function registerWorktreeInputsControl(): void {
  setPluginSlotRegistrations("environment-git-worktree", {
    ...EMPTY_SLOT_REGISTRATIONS,
    environmentProviderInputs: [
      {
        environmentProviderId: "git-worktree",
        component: WorktreeInputsControl,
      },
    ],
  });
}

function CheckoutInputsControl({
  value,
  onChange,
}: PluginEnvironmentProviderInputsProps) {
  useEffect(() => {
    if (value === null) onChange({ status: "ready", value: {} });
  }, [onChange, value]);
  return null;
}

function registerCheckoutInputsControl(): void {
  setPluginSlotRegistrations("environment-project-checkout", {
    ...EMPTY_SLOT_REGISTRATIONS,
    environmentProviderInputs: [
      {
        environmentProviderId: "project-checkout",
        component: CheckoutInputsControl,
      },
    ],
  });
}

describe("a model picked from another provider's tab", () => {
  beforeEach(() => {
    resetFixedPanelTabsStateForTest();
    mocks.promptBoxProps.length = 0;
    mocks.promptHistoryQueryOptions.length = 0;
    mocks.copyAttachments.mockReset();
    mocks.uploadAttachment.mockReset();
    mocks.projectThreads = [];
    mocks.sidebarNavigationSettled = true;
    mocks.sidebarNavigationReplayed = false;
    mocks.extraProjects = [];
    mocks.plugins = [];
    mocks.serverAccessReady = true;
    mocks.machineProviders = [];
    mocks.modelsLoading = false;
    mocks.permissionCeiling = undefined;
    mocks.environmentProviders = [
      CHECKOUT_PROVIDER,
      MANAGED_WORKTREE_SUGAR_PROVIDER,
      PERSONAL_WORKSPACE_PROVIDER,
    ];
    resetPluginSlotStoreForTest();
    registerWorktreeInputsControl();
    registerCheckoutInputsControl();
    window.localStorage.clear();
    window.sessionStorage.clear();
    getPromptDraftAccessor({ kind: "new-thread" }).setDraft({
      text: "",
      mentions: [],
      attachments: [],
    });
  });

  afterEach(() => {
    cleanup();
    setComposerSelectionSettleTimeoutForTest(null);
    vi.restoreAllMocks();
  });

  function RootLikeComposer({
    initialProjectId,
  }: {
    initialProjectId: string;
  }) {
    const [projectId, setProjectId] = useState(initialProjectId);
    return (
      <NewThreadComposer
        projectId={projectId}
        onProjectChange={setProjectId}
        draftStorage={{ kind: "new-thread" }}
        selectionScope="new-thread"
        onSubmit={() => undefined}
      >
        {(composer) =>
          composer.renderPromptBox({ mentionMenuPlacement: "bottom" })
        }
      </NewThreadComposer>
    );
  }

  function rootLikeElement(projectId: string) {
    return (
      <Provider>
        <MemoryRouter>
          <RootLikeComposer initialProjectId={projectId} />
        </MemoryRouter>
      </Provider>
    );
  }

  it("selects that provider, model and level in one change and leaves the old provider's model alone", async () => {
    render(rootLikeElement("proj_1"));
    await waitFor(() => {
      expect(latestPromptBoxProps().execution.provider.selectedId).toBe("codex");
    });
    act(() => {
      latestPromptBoxProps().execution.model.onChange("gpt-5.6");
    });
    await waitFor(() => {
      expect(latestPromptBoxProps().execution.model.selected).toBe("gpt-5.6");
    });
    const pick = latestPromptBoxProps().execution.provider.onProviderModelChange;
    expect(pick).toBeTypeOf("function");

    act(() => {
      pick({ providerId: "claude-code", model: "gpt-5.6-sol", reasoningLevel: "high" });
    });
    await waitFor(() => {
      const execution = latestPromptBoxProps().execution;
      expect(execution.provider.selectedId).toBe("claude-code");
      expect(execution.model.selected).toBe("gpt-5.6-sol");
      expect(execution.reasoning.value).toBe("high");
    });

    act(() => {
      latestPromptBoxProps().execution.provider.onChange("codex");
    });
    await waitFor(() => {
      const execution = latestPromptBoxProps().execution;
      expect(execution.provider.selectedId).toBe("codex");
      expect(execution.model.selected).toBe("gpt-5.6");
    });
  });

  it("selects the provider with its default model when only a level is picked", async () => {
    render(rootLikeElement("proj_1"));
    await waitFor(() => {
      expect(latestPromptBoxProps().execution.provider.selectedId).toBe("codex");
    });
    act(() => {
      latestPromptBoxProps().execution.provider.onProviderModelChange({
        providerId: "claude-code",
        model: "gpt-5.6",
        reasoningLevel: "low",
      });
    });
    await waitFor(() => {
      const execution = latestPromptBoxProps().execution;
      expect(execution.provider.selectedId).toBe("claude-code");
      expect(execution.model.selected).toBe("gpt-5.6");
      expect(execution.reasoning.value).toBe("low");
    });
  });
});
