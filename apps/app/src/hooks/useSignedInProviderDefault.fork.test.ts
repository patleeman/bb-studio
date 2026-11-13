// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import type { SystemProviderState } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  signedInProviderFor,
  useSignedInProviderDefault,
} from "./useSignedInProviderDefault.fork";

const states = vi.hoisted(() => ({
  providers: undefined as SystemProviderState[] | undefined,
}));

vi.mock("./queries/system-queries", () => ({
  useSystemProviderStates: () => ({
    data:
      states.providers === undefined
        ? undefined
        : { providers: states.providers },
  }),
}));

function provider(
  providerId: string,
  status: SystemProviderState["status"],
): SystemProviderState {
  return {
    providerId,
    displayName: providerId,
    status,
    localLoginCommand: null,
    internal_DO_NOT_USE_guidedSignIn: false,
    internal_DO_NOT_USE_setupGuidePlanLabel: null,
  } as SystemProviderState;
}

const signedOutCodex = [
  provider("codex", "unauthenticated"),
  provider("claude-code", "ready"),
];

afterEach(() => {
  states.providers = undefined;
});

describe("a new conversation starts on a signed-in provider", () => {
  it("moves a signed-out remembered provider to a signed-in one", () => {
    expect(signedInProviderFor("codex", signedOutCodex)).toBe("claude-code");
    expect(
      signedInProviderFor("opencode", [
        provider("opencode", "not_installed"),
        provider("claude-code", "ready"),
      ]),
    ).toBe("claude-code");
  });

  it("keeps a ready, unknown or unlisted provider", () => {
    expect(signedInProviderFor("claude-code", signedOutCodex)).toBeNull();
    expect(
      signedInProviderFor("codex", [
        provider("codex", "unknown"),
        provider("claude-code", "ready"),
      ]),
    ).toBeNull();
    expect(signedInProviderFor("pi", signedOutCodex)).toBeNull();
  });

  it("keeps the provider when nothing is signed in", () => {
    expect(
      signedInProviderFor("codex", [
        provider("codex", "unauthenticated"),
        provider("claude-code", "unauthenticated"),
      ]),
    ).toBeNull();
  });

  it("switches once when the composer opens, then leaves later picks alone", () => {
    states.providers = signedOutCodex;
    const setProviderId = vi.fn();
    const { rerender } = renderHook(
      ({ providerId }) =>
        useSignedInProviderDefault({
          providerId,
          setProviderId,
          locked: () => false,
        }),
      { initialProps: { providerId: "codex" } },
    );
    expect(setProviderId).toHaveBeenCalledTimes(1);
    expect(setProviderId).toHaveBeenCalledWith("claude-code");

    rerender({ providerId: "claude-code" });
    rerender({ providerId: "codex" });
    expect(setProviderId).toHaveBeenCalledTimes(1);
  });

  it("decides again on the next visit to the composer, not while it is in use", () => {
    states.providers = signedOutCodex;
    const setProviderId = vi.fn();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(MemoryRouter, { initialEntries: ["/new"] }, children);
    const { result, rerender } = renderHook(
      ({ providerId }) => {
        useSignedInProviderDefault({
          providerId,
          setProviderId,
          locked: () => false,
        });
        return useNavigate();
      },
      { initialProps: { providerId: "claude-code" }, wrapper },
    );
    rerender({ providerId: "codex" });
    expect(setProviderId).not.toHaveBeenCalled();

    act(() => {
      void result.current("/new");
    });
    rerender({ providerId: "codex" });
    expect(setProviderId).toHaveBeenCalledWith("claude-code");
  });

  it("does not switch a provider a plugin locked", () => {
    states.providers = signedOutCodex;
    const setProviderId = vi.fn();
    renderHook(() =>
      useSignedInProviderDefault({
        providerId: "codex",
        setProviderId,
        locked: () => true,
      }),
    );
    expect(setProviderId).not.toHaveBeenCalled();
  });
});
