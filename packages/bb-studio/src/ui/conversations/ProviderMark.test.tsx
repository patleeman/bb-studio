// @vitest-environment happy-dom
// The Bot sidebar's provider marks: one per provider as BB draws it, BB's
// generic agent glyph for a provider it doesn't list, the tooltip and name
// ("Claude Code · Opus 5.5"), and a running row keeping its spinner.
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import { ConversationRowView, WorkerRowView } from "./BotSidebarPanel";
import { ProviderMark, providerLabel, UNKNOWN_PROVIDER } from "./ProviderMark";
import type { ConversationLine, WorkerLine } from "./model";
import type { ProviderCatalogEntry } from "../bot/ProviderStatusMark";

installTestPluginRuntime();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tint = { iconTint: { light: "#d97757", dark: "#d97757" } };
const PROVIDERS = [
  { id: "claude-code", displayName: "Claude Code", logoUrl: "/api/v1/system/providers/claude-code/logo", strings: tint },
  { id: "codex", displayName: "Codex", logoUrl: "/api/v1/system/providers/codex/logo" },
  { id: "pi", displayName: "Pi", logoUrl: null, icon: { glyph: "Pi" } },
  { id: "acp-hermes", displayName: "Hermes", logoUrl: "/api/v1/system/providers/acp-hermes/logo" },
] as unknown as ProviderCatalogEntry[];

let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const render = async (node: ReactElement) => { await act(async () => { root.render(node); }); };
const mark = () => host.querySelector<HTMLElement>('[data-testid="provider-mark"]')!;
const logo = () => mark().querySelector<HTMLElement>("[data-provider-kind]")!;

const conversation = (over: Partial<ConversationLine> = {}): ConversationLine => ({
  threadId: "thr_demo000001", title: "Plan the week", isMain: false, forkedFrom: null, projectId: "proj_demo", updatedAt: Date.now(),
  latest: "Done.", running: false, needsYou: null, mirrored: false, selected: false, providerId: "claude-code", modelName: "Opus 5.5", ...over,
});
const worker = (over: Partial<WorkerLine> = {}): WorkerLine => ({
  threadId: "thr_demo000002", title: "Fix the build", status: "done", ownerConversationId: null, ownerTitle: null, projectId: "proj_demo", updatedAt: Date.now(),
  tag: null, branch: null, mirrored: false, sameTitle: 1, selected: false, providerId: "codex", modelName: "gpt 5.5", ...over,
});

describe("provider mark", () => {
  it.each([
    ["claude-code", "Claude Code", "/api/v1/system/providers/claude-code/logo", undefined],
    ["codex", "Codex", "/api/v1/system/providers/codex/logo", undefined],
    ["pi", "Pi", undefined, "Pi"],
    ["acp-hermes", "Hermes", "/api/v1/system/providers/acp-hermes/logo", undefined],
  ])("draws %s with BB's provider icon", async (id, name, logoUrl, glyph) => {
    await render(<ProviderMark provider={{ providerId: id, modelName: null }} providers={PROVIDERS} />);
    expect(mark().dataset.providerId).toBe(id);
    expect(mark().hasAttribute("data-known")).toBe(true);
    expect(mark().getAttribute("aria-label")).toBe(name);
    expect(logo().dataset.providerKind).toBe("agent");
    expect(logo().dataset.providerId).toBe(id);
    expect(logo().dataset.providerLogo).toBe(logoUrl);
    expect(logo().dataset.providerGlyph).toBe(glyph);
  });

  it("leaves out the brand tint, so the mark takes the row's muted ink", async () => {
    await render(<ProviderMark provider={{ providerId: "claude-code" }} providers={PROVIDERS} />);
    expect(logo().dataset.providerTint).toBeUndefined();
    expect(mark().className).toContain("size-3");
  });

  it("falls back to BB's generic agent glyph for a provider BB doesn't list", async () => {
    await render(<ProviderMark provider={{ providerId: "acp-mystery", modelName: null }} providers={PROVIDERS} />);
    expect(mark().hasAttribute("data-known")).toBe(false);
    expect(logo().dataset.providerId).toBe("acp-mystery");
    expect(logo().dataset.providerLogo).toBeUndefined();
    expect(logo().dataset.providerFallback).toBe("Bot");
    expect(mark().title).toBe("acp-mystery");
  });

  it("names an unknown provider when the row has none", async () => {
    await render(<ProviderMark provider={null} providers={PROVIDERS} />);
    expect(logo().dataset.providerFallback).toBe("Bot");
    expect(mark().title).toBe(UNKNOWN_PROVIDER);
    expect(mark().getAttribute("aria-label")).toBe(UNKNOWN_PROVIDER);
  });

  it("says the provider and the model in its tooltip and name", async () => {
    await render(<ProviderMark provider={{ providerId: "claude-code", modelName: "Opus 5.5" }} providers={PROVIDERS} />);
    expect(mark().title).toBe("Claude Code · Opus 5.5");
    expect(mark().getAttribute("role")).toBe("img");
    expect(mark().getAttribute("aria-label")).toBe("Claude Code · Opus 5.5");
  });

  it("labels before BB's catalog loads with the provider id", () => {
    expect(providerLabel({ providerId: "codex", modelName: "gpt 5.5" }, [])).toBe("codex · gpt 5.5");
  });
});

describe("rows", () => {
  it("puts the mark left of a conversation's title", async () => {
    await render(<ConversationRowView row={conversation()} now={Date.now()} onOpen={() => {}} menuTarget={null} providers={PROVIDERS} />);
    const line = host.querySelector('[data-testid="conversation-title"]')!.parentElement!;
    expect(line.firstElementChild).toBe(mark());
    expect(mark().title).toBe("Claude Code · Opus 5.5");
  });

  it("keeps a running conversation's spinner", async () => {
    await render(<ConversationRowView row={conversation({ running: true })} now={Date.now()} onOpen={() => {}} menuTarget={null} providers={PROVIDERS} />);
    expect(host.querySelector('[data-testid="conversation-line"] [aria-label="Working"]')).not.toBeNull();
    expect(mark()).not.toBeNull();
  });

  it("marks an idle conversation too", async () => {
    await render(<ConversationRowView row={conversation({ running: false, providerId: "pi", modelName: null })} now={Date.now()} onOpen={() => {}} menuTarget={null} providers={PROVIDERS} />);
    expect(mark().title).toBe("Pi");
  });

  it("puts the mark between a worker's status and its title, and keeps a running worker's spinner", async () => {
    await render(<WorkerRowView row={worker({ status: "running" })} now={Date.now()} onOpen={() => {}} menuTarget={null} providers={PROVIDERS} />);
    const row = host.querySelector('[data-testid="worker-row"]')!;
    expect(row.querySelector('[data-status="running"]')).not.toBeNull();
    expect(mark().nextElementSibling?.getAttribute("data-testid")).toBe("worker-title");
    expect(mark().title).toBe("Codex · gpt 5.5");
  });
});
