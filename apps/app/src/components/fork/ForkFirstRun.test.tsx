// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { defaultAppSettings } from "@bb/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingGate } from "@/components/onboarding/OnboardingGate";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";
import { pluginListQueryKey } from "@/hooks/queries/query-keys";
import {
  markPluginFrontendsSettled,
  resetPluginFrontendBootStateForTest,
} from "@/lib/plugin-frontend-boot-state";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";

const mocks = vi.hoisted(() => ({ mutate: vi.fn() }));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: {
      generalSettings: { ...defaultAppSettings, onboardingCompletedAt: null },
    },
    isError: false,
  }),
  useSetupGuideAssignment: () => ({
    isPending: false,
    data: { variant: "control" },
  }),
  useHostProviderCliStatus: () => undefined,
}));
vi.mock("@/hooks/queries/host-queries", () => ({ usePrimaryHost: () => null }));
vi.mock("@/hooks/mutations/settings-mutations", () => ({
  useUpdateGeneralSettings: () => ({ mutate: mocks.mutate }),
}));
vi.mock("@/components/onboarding/OnboardingFlow", () => ({
  OnboardingFlow: () => <p>bb setup guide</p>,
}));

function renderGate(plugins: unknown[] | "pending") {
  const client = new QueryClient();
  if (plugins !== "pending")
    client.setQueryData(pluginListQueryKey(true), plugins);
  else
    client.prefetchQuery({
      queryKey: pluginListQueryKey(true),
      queryFn: () => new Promise(() => {}),
    });
  return render(
    <QueryClientProvider client={client}>
      <OnboardingGate>
        <p>App shell</p>
      </OnboardingGate>
    </QueryClientProvider>,
  );
}

const studio = { enabled: true, app: { bundle: { jsUrl: "/studio.js" } } };

beforeEach(() => resetPluginFrontendBootStateForTest());
afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  resetAllCrashedPluginSlotsForTest();
  vi.clearAllMocks();
});

describe("a plugin's first run", () => {
  it("holds bb's setup guide while plugin frontends load, and shows it when none takes over", async () => {
    renderGate([studio]);
    expect(screen.queryByText("bb setup guide")).toBeNull();
    expect(screen.queryByText("App shell")).toBeNull();
    act(() => markPluginFrontendsSettled());
    expect(await screen.findByText("bb setup guide")).toBeTruthy();
  });

  it("fetches the plugin list itself when nothing has, and holds bb's setup guide meanwhile", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <OnboardingGate>
          <p>App shell</p>
        </OnboardingGate>
      </QueryClientProvider>,
    );
    expect(screen.queryByText("bb setup guide")).toBeNull();
    expect(client.getQueryState(pluginListQueryKey(true))?.status).toBe(
      "pending",
    );
    vi.unstubAllGlobals();
  });

  it("holds the screen while the plugin list loads", () => {
    renderGate("pending");
    expect(screen.queryByText("bb setup guide")).toBeNull();
  });

  it("finishes bb's first run at once for a slot with no component", () => {
    setPluginSlotRegistrations(
      "studio",
      makePluginRegistrationSet({ firstRuns: [{ id: "welcome" }] }),
    );
    renderGate([studio]);
    expect(screen.queryByText("bb setup guide")).toBeNull();
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    const patch = mocks.mutate.mock.calls[0]?.[0] as {
      onboardingCompletedAt: string;
    };
    expect(Number.isNaN(Date.parse(patch.onboardingCompletedAt))).toBe(false);
  });

  it("draws the plugin's first run instead of bb's, and finish completes it once", () => {
    setPluginSlotRegistrations(
      "studio",
      makePluginRegistrationSet({
        firstRuns: [
          {
            id: "welcome",
            component: ({ finish }) => (
              <button type="button" onClick={finish}>
                Studio welcome
              </button>
            ),
          },
        ],
      }),
    );
    renderGate([studio]);
    expect(screen.queryByText("bb setup guide")).toBeNull();
    fireEvent.click(screen.getByText("Studio welcome"));
    fireEvent.click(screen.getByText("Studio welcome"));
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
  });
});
