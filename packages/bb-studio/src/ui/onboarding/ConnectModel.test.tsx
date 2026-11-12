// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";

vi.mock("../../kit/ui/hooks/use-compact-viewport.js", () => ({ useIsCompactViewport: () => false }));
vi.mock("../../kit/ui/hooks/use-pointer-coarse.js", () => ({ usePointerCoarse: () => false }));
vi.mock("../live", () => ({ useCall: () => async () => ({ sessionId: "s", state: "waiting", targetId: "provider:codex", name: "Codex", flow: "device", url: null, code: null, acceptsCode: false, expiresAt: null, pollMs: 1000, message: null }), useLive: () => ({ data: null, refresh: () => {} }) }));

const { ConnectModelView } = await import("./ConnectModel");
const { anyReady, canSignIn, sortCards } = await import("./providers");

installTestPluginRuntime();

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const card = (providerId: string, displayName: string, status: string, loginCommand: string | null = "login") => ({ providerId, displayName, status, accountEmail: null, loginCommand });

it("lists every provider with its state, signs in inline, and skips", () => {
  const onSkip = vi.fn();
  const cards = sortCards([card("pi", "Pi", "not_installed", null), card("codex", "Codex", "unauthenticated"), card("claude-code", "Claude Code", "not_installed", null)]);
  act(() => root.render(<ConnectModelView cards={cards} onSkip={onSkip} />));
  expect(host.querySelector("h1")?.textContent).toBe("Connect a model");
  expect([...host.querySelectorAll("[data-provider]")].map((each) => [each.getAttribute("data-provider"), each.textContent?.includes("Sign in")])).toEqual([["claude-code", false], ["codex", true], ["pi", false]]);
  act(() => (host.querySelector("[data-testid=provider-sign-in]") as HTMLButtonElement).click());
  expect(host.querySelector("[data-provider=codex] [data-testid=provider-sign-in]")).toBeNull();
  act(() => (host.querySelector("[data-testid=connect-skip]") as HTMLButtonElement).click());
  expect(onSkip).toHaveBeenCalledOnce();
});

it("counts only a ready provider as connected", () => {
  expect(anyReady([card("codex", "Codex", "unauthenticated")])).toBe(false);
  expect(anyReady([card("codex", "Codex", "ready")])).toBe(true);
  expect(anyReady(null)).toBe(false);
  expect(canSignIn(card("codex", "Codex", "expired"))).toBe(true);
  expect(canSignIn(card("codex", "Codex", "unauthenticated", null))).toBe(false);
});
