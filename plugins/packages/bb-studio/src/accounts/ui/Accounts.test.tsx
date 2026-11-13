// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import type { AccountView, AccountsStatus, Warning } from "../contract";

vi.mock("../../kit/ui/hooks/use-compact-viewport.js", () => ({ useIsCompactViewport: () => false }));
vi.mock("../../kit/ui/hooks/use-pointer-coarse.js", () => ({ usePointerCoarse: () => false }));
vi.mock("../../ui/live", () => ({ useCall: () => async () => ({}), useLive: () => ({ data: null, refresh: () => {} }) }));

const { AccountsPanel, needsSignIn, signInLabel } = await import("./AccountsPanel");
const { WarningList, actionLabel, freshWarnings, warningsWindowOptions, watchStep } = await import("./Warnings");
const { pooledFamily, signedOutPoolAccount } = await import("./notices");
const { AccountsNotice, AccountsNoticePill, attentionWarnings, noticeText } = await import("./AccountsNotice");
const { accountNeeds } = await import("../../auth/ui/needs");
const { openAccounts, setAccountsFooter, useSigningIn } = await import("./store");
const { closeRelogin, useReloginTarget } = await import("../../auth/ui/relogin-store");

installTestPluginRuntime();

const RESET = Date.UTC(2026, 10, 16, 9, 0);
const NOW = Date.UTC(2026, 10, 12, 16, 0);

function account(over: Partial<AccountView> & { key: string }): AccountView {
  const [source, id] = over.key.split(":") as [AccountView["source"], string];
  return { id, source, provider: "claude", name: "Claude", label: "Sam", state: "ready", message: null, windows: [], models: [], pinned: [], signIn: source === "local" ? null : `${source === "studio" ? "pool" : "bb"}:${id}`, ...over };
}

const STATUS: AccountsStatus = {
  checkedAt: NOW,
  sources: [{ source: "studio", name: "BB Studio", state: "on" }, { source: "bb", name: "bb", state: "on" }, { source: "local", name: "This Mac", state: "on" }],
  accounts: [
    account({ key: "studio:a", state: "signed_out", message: "Refresh refused", windows: [{ id: "secondary", label: "7d", percent: 97, resetAt: RESET, rejected: false }], models: [{ id: "fable", label: "Fable", percent: 100, resetAt: RESET, rejected: true }], pinned: [{ threadId: "thr_1", title: "Fix the sync" }] }),
    account({ key: "bb:a", windows: [{ id: "primary", label: "5h", percent: 12, resetAt: RESET, rejected: false }] }),
    account({ key: "bb:c", provider: "codex", name: "Codex", state: "error", message: "HTTP 500" }),
    account({ key: "local:claude-code", name: "Claude Code", label: "Account Pooler", signIn: "provider:claude-code" }),
  ],
  warnings: [],
  dismissed: [],
};

const warning = (over: Partial<Warning> & { id: string }): Warning => ({ accountKey: "studio:a", source: "studio", kind: "signed_out", title: "Claude signed out", detail: "BB Studio · Sam", action: "sign_in", target: "pool:a", ...over });

let root: Root | null = null;
const container = () => document.body.lastElementChild as HTMLElement;
async function render(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(node); });
}

beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); });
afterEach(() => { if (root) act(() => root?.unmount()); root = null; document.body.replaceChildren(); vi.unstubAllGlobals(); closeRelogin(); setAccountsFooter(null); });

const api = { start: vi.fn(async () => { throw new Error("no"); }), poll: vi.fn(), complete: vi.fn(), cancel: vi.fn(async () => ({})) };

describe("Accounts panel", () => {
  it("shows each source, state and quota with reset times, no thread list and no scroller of its own, and labels the bb sign-in", async () => {
    const onSignIn = vi.fn();
    await render(<AccountsPanel status={STATUS} error={null} signingIn={null} onSignIn={onSignIn} onSignInDone={() => {}} onRefresh={() => {}} onClose={() => {}} api={api} now={NOW} />);
    const root = container();
    expect([...root.querySelectorAll("[data-accounts-source]")].map((node) => node.getAttribute("data-accounts-source"))).toEqual(["studio", "bb", "local"]);
    const studio = root.querySelector('[data-account="studio:a"]')!;
    expect(studio.querySelector('[data-testid="account-state"]')?.textContent).toBe("Signed out");
    expect(studio.textContent).toContain("97%");
    expect(studio.textContent).toContain("Fable");
    expect(studio.textContent).toContain("rejected");
    expect(studio.textContent).toMatch(/resets Nov 16/);
    expect(studio.textContent).toContain("Refresh refused");
    expect(studio.textContent).not.toContain("Fix the sync");
    expect(root.querySelector('[data-testid="accounts"]')?.className).not.toMatch(/overflow|max-h/);
    await act(async () => { (studio.querySelector('[data-testid="account-sign-in"]') as HTMLButtonElement).click(); });
    expect(onSignIn).toHaveBeenCalledWith(expect.objectContaining({ key: "studio:a" }));
    expect(root.querySelector('[data-account="bb:c"] [data-testid="account-sign-in"]')?.textContent).toBe("Sign in to bb");
    expect(root.querySelector('[data-account="bb:a"] [data-testid="account-sign-in"]')).toBeNull();
    expect(root.querySelector('[data-account="local:claude-code"]')?.textContent).toContain("Account Pooler");
  });

  it("runs the sign-in inline in the account's row", async () => {
    await render(<AccountsPanel status={STATUS} error={null} signingIn="studio:a" onSignIn={() => {}} onSignInDone={() => {}} onRefresh={() => {}} onClose={() => {}} api={api} now={NOW} />);
    await act(async () => { await Promise.resolve(); });
    expect(api.start).toHaveBeenCalledWith("pool:a");
    expect(container().querySelector('[data-account="studio:a"] [data-testid="relogin"]')).not.toBeNull();
  });

  it("shows a local login that isn't signed in as Signed out with Sign in, and wraps reset times and labels instead of cutting them off", async () => {
    const onSignIn = vi.fn();
    const status: AccountsStatus = {
      ...STATUS,
      accounts: [
        account({ key: "local:claude-code", name: "Claude Code", label: "someone-with-a-long-address@example.test · Ultra", signIn: "provider:claude-code", windows: [{ id: "weekly", label: "Weekly limit", percent: 45, resetAt: RESET, rejected: false }] }),
        account({ key: "local:codex", provider: "codex", name: "Codex", label: null, state: "signed_out", signIn: "provider:codex" }),
      ],
    };
    await render(<AccountsPanel status={status} error={null} signingIn={null} onSignIn={onSignIn} onSignInDone={() => {}} onRefresh={() => {}} onClose={() => {}} api={api} now={NOW} />);
    const root = container();
    expect(root.querySelectorAll(".truncate")).toHaveLength(0);
    const reset = root.querySelector('[data-account="local:claude-code"] [data-testid="quota-reset"]')!;
    expect(reset.textContent).toMatch(/^resets Nov 16, /);
    expect(reset.className).toContain("whitespace-nowrap");
    expect(reset.parentElement!.className).toContain("flex-wrap");
    expect(root.querySelector('[data-account="local:claude-code"] [data-testid="account-label"]')!.className).toContain("break-all");
    const codex = root.querySelector('[data-account="local:codex"]')!;
    expect(codex.querySelector('[data-testid="account-state"]')!.textContent).toBe("Signed out");
    expect(codex.querySelector('[data-testid="account-sign-in"]')!.textContent).toBe("Sign in");
    await act(async () => { (codex.querySelector('[data-testid="account-sign-in"]') as HTMLButtonElement).click(); });
    expect(onSignIn).toHaveBeenCalledWith(expect.objectContaining({ key: "local:codex" }));
  });

  it("offers Sign in only for signed-out or failing accounts with a sign-in", () => {
    expect(needsSignIn(account({ key: "studio:a", state: "signed_out" }))).toBe(true);
    expect(needsSignIn(account({ key: "studio:a", state: "limited" }))).toBe(false);
    expect(needsSignIn(account({ key: "studio:a", state: "signed_out", signIn: null }))).toBe(false);
    expect(signInLabel({ source: "bb" })).toBe("Sign in to bb");
    expect(signInLabel({ source: "studio" })).toBe("Sign in");
  });
});

describe("warnings", () => {
  it("names the problem with one action and a dismiss", async () => {
    const run = vi.fn();
    const dismiss = vi.fn();
    const list = [
      warning({ id: "studio:a:signed_out" }),
      warning({ id: "bb:a:model:fable:rejected", source: "bb", accountKey: "bb:a", kind: "model", title: "Fable at 100%", detail: "bb · Sam · resets Nov 16, 09:00", action: "switch_model" }),
      warning({ id: "studio:b:window:secondary:high", accountKey: "studio:b", kind: "window", title: "Claude 7d at 92%", action: "use_other" }),
    ];
    await render(<WarningList warnings={list} actions={{ run, dismiss }} />);
    const cards = [...container().querySelectorAll("[data-warning]")];
    expect(cards.map((card) => [card.querySelector("span.font-medium")?.textContent, card.querySelector('[data-testid="warning-action"]')?.textContent])).toEqual([
      ["Claude signed out", "Sign in"],
      ["Fable at 100%", "Switch model"],
      ["Claude 7d at 92%", "Use other account"],
    ]);
    await act(async () => { (cards[1]!.querySelector('[data-testid="warning-action"]') as HTMLButtonElement).click(); });
    expect(run).toHaveBeenCalledWith(list[1]);
    await act(async () => { (cards[0]!.querySelector('[data-testid="warning-dismiss"]') as HTMLButtonElement).click(); });
    expect(dismiss).toHaveBeenCalledWith(list[0]);
    expect(actionLabel(warning({ id: "bb:a:signed_out", source: "bb" }))).toBe("Sign in to bb");
  });

  it("opens the toast window in the top right, sized to its cards, only for warnings not shown yet", () => {
    expect(warningsWindowOptions(2, { availLeft: 0, availTop: 25, availWidth: 1512 })).toMatchObject({ x: 1512 - 360 - 32, y: 37, width: 376, alwaysOnTop: true, transparent: true, frame: false });
    expect(warningsWindowOptions(9, { availWidth: 1000 }).height).toBe(warningsWindowOptions(4, { availWidth: 1000 }).height);
    expect(freshWarnings([warning({ id: "a" }), warning({ id: "b" })], new Set(["a"])).map((each) => each.id)).toEqual(["b"]);
  });

  it("opens the window for a local login only when a quota is used up, and for a pool account from 90%", () => {
    const shown = new Set<string>();
    const localHigh = warning({ id: "local:codex:window:5 hour window:high", source: "local", accountKey: "local:codex", kind: "window", title: "Codex 5h at 92%", action: "switch_model" });
    const localFull = warning({ id: "local:codex:window:5 hour window:rejected", source: "local", accountKey: "local:codex", kind: "window", title: "Codex 5h at 100%", action: "switch_model" });
    const poolHigh = warning({ id: "studio:b:window:secondary:high", accountKey: "studio:b", kind: "window", title: "Claude 7d at 92%", action: "use_other" });
    expect(watchStep([localHigh], shown, false)).toEqual({ list: [], open: false });
    expect(watchStep([localFull], shown, false)).toEqual({ list: [localFull], open: true });
    expect(watchStep([localFull], shown, true)).toEqual({ list: [localFull], open: true });
    expect(watchStep([], shown, true)).toEqual({ list: [], open: false });
    expect(watchStep([localFull], shown, false)).toEqual({ list: [localFull], open: true });
    expect(watchStep([localFull], shown, false).open).toBe(false);
    expect(watchStep([poolHigh], new Set(), false)).toEqual({ list: [poolHigh], open: true });
  });

  it("puts each warning in Needs you, with its action, dismiss and Accounts", () => {
    const run = vi.fn();
    const dismiss = vi.fn();
    const open = vi.fn();
    const needs = accountNeeds({ warnings: [warning({ id: "studio:a:signed_out" })] }, { run, dismiss }, open);
    expect(needs.map((need) => [need.key, need.title, need.action.label])).toEqual([["account:studio:a:signed_out", "Claude signed out", "Sign in"]]);
    needs[0]!.action.run();
    needs[0]!.dismiss!();
    needs[0]!.open!();
    expect(run).toHaveBeenCalledOnce();
    expect(dismiss).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledOnce();
  });
});

describe("footer notice", () => {
  const codex = account({ key: "local:codex", provider: "codex", name: "Codex", state: "signed_out" });
  const signedOut = warning({ id: "local:codex:signed_out", accountKey: "local:codex", source: "local", title: "Codex signed out" });
  const full = warning({ id: "studio:a:window:secondary:rejected", kind: "window", title: "Claude 7d at 100%", action: "switch_model" });
  const high = warning({ id: "studio:a:window:primary:high", kind: "window", title: "Claude 5h at 92%", action: "use_other" });

  it("says nothing while every account works or is only close to a limit", () => {
    expect(noticeText({ accounts: STATUS.accounts, warnings: [] })).toBeNull();
    expect(noticeText({ accounts: STATUS.accounts, warnings: [high] })).toBeNull();
    expect(noticeText(null)).toBeNull();
  });

  it("names a provider that needs sign-in, an exhausted quota, and how many more", () => {
    const accounts = [...STATUS.accounts, codex];
    expect(noticeText({ accounts, warnings: [signedOut] })).toBe("Codex needs sign-in");
    expect(noticeText({ accounts, warnings: [full] })).toBe("Claude 7d at 100%");
    expect(noticeText({ accounts, warnings: [high, signedOut, full] })).toBe("Codex needs sign-in · +1");
    expect(attentionWarnings({ warnings: [high, full] }).map((each) => each.id)).toEqual([full.id]);
    expect(noticeText({ accounts, warnings: [warning({ id: "providers:none", accountKey: "providers:none", title: "No provider signed in", source: "local" })] })).toBe("No provider signed in");
  });

  it("opens Accounts from the pill, and draws nothing outside the footer", async () => {
    const onOpen = vi.fn();
    await render(<AccountsNoticePill text="Codex needs sign-in" severe onOpen={onOpen} />);
    const pill = container().querySelector('[data-testid="accounts-notice"]') as HTMLButtonElement;
    expect(pill.textContent).toBe("Codex needs sign-in");
    await act(async () => { pill.click(); });
    expect(onOpen).toHaveBeenCalledOnce();
    await render(<AccountsNotice activeThreadId={null} activeProjectId={null} isCompactViewport={false} onNavigate={() => {}} />);
    expect(container().childElementCount).toBe(0);
  });
});

describe("signed-out notices and opening", () => {
  it("states Signed out under a model list that failed through a signed-out pool", () => {
    expect(pooledFamily("Claude Code", "Listing Claude models from http://127.0.0.1:38986/api/v1/plugins/account-pool/http/claude/v1/models failed with HTTP 429.")).toBe("claude");
    expect(pooledFamily("Claude Code", "Timed out")).toBeNull();
    expect(signedOutPoolAccount(STATUS.accounts, "claude")?.key).toBe("studio:a");
    expect(signedOutPoolAccount([...STATUS.accounts, account({ key: "studio:b" })], "claude")).toBeNull();
  });

  it("opens Accounts on the account's inline sign-in, or the sign-in dialog when BB has no footer item", async () => {
    let seen: string | null = null;
    let dialog: string | null = null;
    function Probe() { seen = useSigningIn(); dialog = useReloginTarget()?.id ?? null; return null; }
    await render(<Probe />);
    const target = { id: "pool:a", name: "Claude", detail: null };
    await act(async () => { openAccounts({ key: "studio:a", target }); });
    expect(dialog).toBe("pool:a");
    const footer = { open: vi.fn(), close: vi.fn(), toggle: vi.fn() };
    setAccountsFooter(footer);
    closeRelogin();
    await act(async () => { openAccounts({ key: "studio:a", target }); });
    expect(footer.open).toHaveBeenCalledOnce();
    expect(seen).toBe("studio:a");
  });
});
