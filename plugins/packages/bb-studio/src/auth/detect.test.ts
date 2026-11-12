import { expect, it } from "vitest";
import type { PoolAccount, ProviderState } from "./contract";
import { isAuthError, poolEntries, providerEntries, resolveTarget } from "./detect";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const account = (over: Partial<PoolAccount>): PoolAccount => ({ id: A, provider: "codex", kind: "oauth", label: "work", email: "w@example.test", enabled: true, status: "ready", error: null, ...over });
const provider = (over: Partial<ProviderState>): ProviderState => ({ providerId: "codex", displayName: "Codex", status: "ready", planLabel: "Pro", accountEmail: null, loginCommand: "codex login --device-auth", ...over });
const none = { seenReady: new Set<string>(), turnErrors: new Set<string>() };

it("marks enabled pool logins in error as signed out", () => {
  const entries = poolEntries([
    account({}),
    account({ id: B, status: "error", error: "refresh_token_invalidated" }),
    account({ id: C, provider: "claude", status: "error", enabled: false }),
    account({ id: "k", kind: "api-key", status: "error" }),
  ]);
  expect(entries.map((entry) => [entry.id, entry.signedOut])).toEqual([[`pool:${A}`, false], [`pool:${B}`, true], [`pool:${C}`, false]]);
  expect(entries[1]).toMatchObject({ source: "pool", provider: "codex", name: "Codex", detail: "work · w@example.test", reason: "expired" });
});

it("marks providers signed out from health and turn errors", () => {
  const states = [
    provider({ status: "expired" }),
    provider({ providerId: "claude-code", displayName: "Claude Code", status: "unauthenticated", loginCommand: "claude auth login" }),
    provider({ providerId: "pi", displayName: "Pi", status: "unauthenticated", loginCommand: null }),
    provider({ providerId: "other", displayName: "Other", status: "not_installed" }),
  ];
  expect(providerEntries(states, none).map((entry) => [entry.id, entry.reason])).toEqual([["provider:codex", "expired"], ["provider:claude-code", null]]);
  expect(providerEntries(states, { ...none, seenReady: new Set(["claude-code"]) })[1]).toMatchObject({ signedOut: true, reason: "signed_out", provider: "claude" });
  expect(providerEntries([provider({})], { ...none, turnErrors: new Set(["codex"]) })[0]).toMatchObject({ signedOut: true, reason: "turn_error" });
  expect(providerEntries([provider({ planLabel: "Proxied" })], { ...none, turnErrors: new Set(["codex"]) })[0]).toMatchObject({ signedOut: false });
});

it("recognises sign-in errors on turns", () => {
  expect(isAuthError("Failed to authenticate: OAuth session expired and could not be refreshed")).toBe(true);
  expect(isAuthError("401 Unauthorized")).toBe(true);
  expect(isAuthError("Host daemon disconnected")).toBe(false);
  expect(isAuthError(null)).toBe(false);
});

it("resolves a provider name, an account id, a label or an email", () => {
  const entries = [
    ...poolEntries([account({ status: "error" }), account({ id: B, label: "home", email: "h@example.test" }), account({ id: C, provider: "claude", label: "max", email: null })]),
    ...providerEntries([provider({}), provider({ providerId: "claude-code", displayName: "Claude Code", loginCommand: "claude auth login" })], none),
  ];
  const id = (name: string) => { const found = resolveTarget(entries, name); return found.ok ? found.entry.id : found.error; };
  expect(id("codex")).toBe(`pool:${A}`);
  expect(id("claude")).toBe("provider:claude-code");
  expect(id("claude-code")).toBe("provider:claude-code");
  expect(id("provider:codex")).toBe("provider:codex");
  expect(id(B)).toBe(`pool:${B}`);
  expect(id("home")).toBe(`pool:${B}`);
  expect(id("h@example.test")).toBe(`pool:${B}`);
  expect(id("3333")).toBe(`pool:${C}`);
  expect(id("nope")).toContain("No provider or account");
  const two = [...poolEntries([account({ status: "error" }), account({ id: B, status: "error" })])];
  const found = resolveTarget(two, "codex");
  expect(found.ok).toBe(false);
});
