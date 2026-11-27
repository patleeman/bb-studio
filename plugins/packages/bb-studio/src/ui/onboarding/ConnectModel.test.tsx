// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";

vi.mock("../../kit/ui/hooks/use-compact-viewport.js", () => ({ useIsCompactViewport: () => false }));
vi.mock("../../kit/ui/hooks/use-pointer-coarse.js", () => ({ usePointerCoarse: () => false }));
vi.mock("../live", () => ({ useCall: () => async () => ({ sessionId: "s", state: "waiting", targetId: "provider:codex", name: "Codex", flow: "device", url: null, code: null, acceptsCode: false, expiresAt: null, pollMs: 1000, message: null }), useLive: () => ({ data: null, refresh: () => {} }) }));

const { ConnectModelView } = await import("./ConnectModel");
const { anyReady, canSignIn, cardsFrom, finishesOnboarding, providerCards, sortCards } = await import("./providers");

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

it("counts a ready agent with no sign-in (an ACP agent on a local model), and leaves out ones that are neither", () => {
  const cards = cardsFrom([
    { providerId: "codex", displayName: "Codex", status: "unauthenticated", loginCommand: "codex login" },
    { providerId: "acp-ollama", displayName: "Ollama", status: "ready", loginCommand: null },
    { providerId: "acp-cursor", displayName: "Cursor", status: "not_installed", loginCommand: null },
  ]);
  expect(cards.map((card) => card.providerId)).toEqual(["codex", "acp-ollama"]);
  expect(anyReady(cards)).toBe(true);
});

it("finishes \"Connect a model\" only on a provider with a sign-in: an installed agent with no account check isn't a connected model", () => {
  const providers = [
    { providerId: "codex", displayName: "Codex", status: "unauthenticated", loginCommand: "codex login" },
    { providerId: "acp-grok", displayName: "Grok", status: "ready", loginCommand: null },
  ];
  // First run (ConnectModel): only sign-in providers count.
  expect(anyReady(providerCards(providers, false))).toBe(false);
  // The composer's gate: the ready agent counts, so the picker (and Auto) shows.
  expect(anyReady(providerCards(providers, true))).toBe(true);
});

it("lists a ready agent with no sign-in as usable on \"Connect a model\", without finishing the step on it", () => {
  const providers = [
    { providerId: "codex", displayName: "Codex", status: "unauthenticated", loginCommand: "codex login" },
    { providerId: "acp-ollama", displayName: "Ollama", status: "ready", loginCommand: null },
  ];
  const cards = providerCards(providers, true);
  act(() => root.render(<ConnectModelView cards={cards} onSkip={() => undefined} />));
  expect(host.querySelector("[data-provider=acp-ollama]")?.textContent).toContain("Ready");
  expect(finishesOnboarding(cards)).toBe(false);
  expect(finishesOnboarding(providerCards([{ ...providers[0]!, status: "ready" }], true))).toBe(true);
});
