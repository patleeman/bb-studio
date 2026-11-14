// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineRow } from "@bb/server-contract";

const mutate = vi.fn();
const dispatch = vi.fn();
const openTerminal = vi.fn(() => true);
let providerStatus = "unauthenticated";
let environmentHostId = "host_local";
let desktop: object | null = {};

vi.mock("@/hooks/queries/thread-queries", () => ({
  useThread: () => ({
    data: { id: "thr_1", providerId: "codex", environmentId: "env_1" },
  }),
}));
vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemProviderStates: () => ({
    data: {
      providers: [
        {
          providerId: "codex",
          displayName: "Codex",
          status: providerStatus,
          loginCommand: "codex login --device-auth",
          localLoginCommand: "codex login",
        },
      ],
    },
  }),
}));
vi.mock("@/hooks/queries/environment-queries", () => ({
  useEnvironment: () => ({ data: { id: "env_1", hostId: environmentHostId } }),
}));
vi.mock("@/hooks/useHostDaemon", () => ({
  useHostDaemon: () => ({
    isLocalDaemonHost: (hostId: string | null | undefined) => hostId === "host_local",
  }),
}));
vi.mock("@/lib/bb-desktop", () => ({
  getBbDesktopInfo: () => desktop,
}));
vi.mock("@/hooks/queries/thread-terminal-queries", () => ({
  useCreateTerminal: () => ({ mutate, isPending: false }),
}));
vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandRunner: () => ({ dispatch }),
}));
vi.mock("@/lib/app-navigation-host", () => ({
  useAppNavigationHost: () => ({ openTerminal }),
}));
vi.mock("./ThreadTimelineNavigationContext", () => ({
  useThreadTimelineNavigation: () => ({ threadId: "thr_1" }),
}));

const { forkSignInErrorBody, signInErrorProviderName } = await import(
  "./SignInErrorActions.fork"
);

function row(title: string): TimelineRow {
  return {
    id: "row_error",
    kind: "system",
    systemKind: "error",
    title,
    detail: "Sign in to Codex, or pick another model.",
    status: "error",
  } as unknown as TimelineRow;
}

beforeEach(() => {
  providerStatus = "unauthenticated";
  environmentHostId = "host_local";
  desktop = {};
  mutate.mockReset();
  dispatch.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("a sign-in error row", () => {
  it("is recognised only for the sign-in title", () => {
    expect(signInErrorProviderName(row("Codex isn't signed in"))).toBe("Codex");
    expect(signInErrorProviderName(row("Provider error"))).toBeNull();
    expect(forkSignInErrorBody(row("Provider error"))).toBeNull();
  });

  it("offers Sign in and Pick another model as buttons, not a code box", () => {
    const { container } = render(<>{forkSignInErrorBody(row("Codex isn't signed in"))}</>);
    expect(screen.getByRole("button", { name: "Sign in to Codex" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Pick another model" })).not.toBeNull();
    expect(container.querySelector("pre")).toBeNull();
  });

  it("runs the provider's login command in a terminal for this conversation and opens it", () => {
    render(<>{forkSignInErrorBody(row("Codex isn't signed in"))}</>);
    fireEvent.click(screen.getByRole("button", { name: "Sign in to Codex" }));
    expect(mutate).toHaveBeenCalledTimes(1);
    const [request, callbacks] = mutate.mock.calls[0] as [
      Record<string, unknown>,
      { onSuccess: (session: unknown) => void },
    ];
    expect(request).toMatchObject({
      title: "Sign in to Codex",
      start: { mode: "command", command: "codex login" },
      target: { kind: "thread", threadId: "thr_1" },
    });
    callbacks.onSuccess({ id: "term_1" });
    expect(openTerminal).toHaveBeenCalledWith({ id: "term_1" });
  });

  it("signs in with a device code when the conversation runs on another machine", () => {
    environmentHostId = "host_remote";
    render(<>{forkSignInErrorBody(row("Codex isn't signed in"))}</>);
    fireEvent.click(screen.getByRole("button", { name: "Sign in to Codex" }));
    expect(mutate.mock.calls[0]?.[0]).toMatchObject({
      start: { mode: "command", command: "codex login --device-auth" },
    });
  });

  it("opens the composer's model picker", () => {
    const composer = document.createElement("div");
    composer.setAttribute("data-app-composer", "");
    composer.setAttribute("data-app-composer-role", "primary");
    document.body.appendChild(composer);
    render(<>{forkSignInErrorBody(row("Codex isn't signed in"))}</>);
    fireEvent.click(screen.getByRole("button", { name: "Pick another model" }));
    expect(dispatch).toHaveBeenCalledWith("modelPicker.toggle", composer);
    composer.remove();
  });

  it("drops Sign in once the provider is signed in again", () => {
    providerStatus = "ready";
    render(<>{forkSignInErrorBody(row("Codex isn't signed in"))}</>);
    expect(screen.queryByRole("button", { name: "Sign in to Codex" })).toBeNull();
    expect(screen.getByRole("button", { name: "Pick another model" })).not.toBeNull();
  });
});
