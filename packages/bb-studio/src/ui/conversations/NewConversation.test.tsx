// @vitest-environment jsdom
// A Bot's + New: BB's composer seeded with the Bot's default model, started
// as that Bot's conversation on whatever was sent.
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  bot: null as unknown,
  call: vi.fn(async (_method: string, _input: unknown): Promise<unknown> => ({ threadId: "thr_new", projectId: "proj_personal" })),
  toThread: vi.fn(),
  composer: null as null | { props: Record<string, unknown>; submit(request: unknown): Promise<void> },
}));
vi.mock("../live", () => ({
  useCall: () => state.call,
  useLive: () => ({ data: state.bot, error: null, loading: false, refresh: () => {} }),
}));
vi.mock("../../kit/app/index", () => ({ StudioBar: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("../page-bar", () => ({ PageBar: ({ title, detail }: { title: string; detail?: string }) => <div data-testid="page-bar"><h1 data-testid="page-bar-title">{title}</h1>{detail ? <span data-testid="page-bar-detail">{detail}</span> : null}</div> }));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useBbNavigate: () => ({ toThread: state.toThread }),
  experimental_NewThreadComposer: (props: Record<string, unknown> & { onSubmit(request: unknown): Promise<void> }) => {
    state.composer = { props, submit: props.onSubmit };
    return <div data-testid="composer" />;
  },
}));

import { NewConversationPage, START_PAGE_CSS } from "./NewConversation";
import { newConversationPath, newConversationRoute } from "./new-conversation";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  state.call.mockClear();
  state.toThread.mockClear();
  state.composer = null;
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

const request = (model: string) => ({
  projectId: "proj_personal", providerId: "claude", model, reasoningLevel: "high", permissionMode: "accept-edits",
  executionInputSources: { providerId: "explicit", model: "explicit" }, environment: { type: "project-default" }, input: [{ type: "text", text: "Hi", mentions: [] }],
});

it("addresses the page by Bot and Main's project", () => {
  expect(newConversationPath("bot_x", "proj_personal")).toBe("new-conversation/bot_x/proj_personal");
  expect(newConversationRoute("new-conversation/bot_x/proj_personal")).toEqual({ botId: "bot_x", projectId: "proj_personal" });
  expect(newConversationRoute("new-conversation/bot_x")).toEqual({ botId: "bot_x", projectId: null });
  expect(newConversationRoute("conversations/bot_x")).toBeNull();
});

it("seeds BB's composer with the Bot's default model and starts the conversation on what was sent", async () => {
  state.bot = { bot: { id: "home", name: "Home", defaultModel: { providerId: "claude", model: "opus", reasoningLevel: "high", modelName: "Opus 5.5" } }, run: null };
  await act(async () => { root.render(<NewConversationPage botId="home" projectId="proj_personal" />); });
  expect(state.composer!.props).toMatchObject({ defaultProviderId: "claude", defaultModel: "opus", defaultReasoningLevel: "high", defaultProjectId: "proj_personal" });
  expect(document.querySelector('[data-testid="page-bar-title"]')?.textContent).toBe("New conversation");
  expect(document.querySelector('[data-testid="page-bar-detail"]')?.textContent).toBe("Home");
  // Patrick picked Sonnet in the composer before sending: that wins.
  await act(async () => { await state.composer!.submit(request("sonnet")); });
  expect(state.call).toHaveBeenCalledWith("bot_conversation_start", { botId: "home", request: expect.objectContaining({ providerId: "claude", model: "sonnet" }) });
  expect(state.toThread).toHaveBeenCalledWith("thr_new");
});

it("without a default, leaves the composer on BB's own choice", async () => {
  state.bot = { bot: { id: "home", name: "Home", defaultModel: null }, run: null };
  await act(async () => { root.render(<NewConversationPage botId="home" projectId={null} />); });
  expect(state.composer!.props.defaultModel).toBeUndefined();
  expect(state.composer!.props.defaultProviderId).toBeUndefined();
  expect(state.composer!.props.defaultProjectId).toBeUndefined();
});

it("shows the composer at once, before the Bot has loaded, and seeds the default model when it arrives", async () => {
  state.bot = null;
  await act(async () => { root.render(<NewConversationPage botId="home" projectId="proj_personal" />); });
  expect(host.querySelector('[data-testid="composer"]')).not.toBeNull();
  expect(state.composer!.props).toMatchObject({ draftKey: "studio-bot-new:home", defaultProjectId: "proj_personal" });
  expect(state.composer!.props.defaultModel).toBeUndefined();
  await act(async () => { await state.composer!.submit(request("sonnet")); });
  expect(state.call).toHaveBeenCalledWith("bot_conversation_start", { botId: "home", request: expect.objectContaining({ model: "sonnet" }) });
  state.bot = { bot: { id: "home", name: "Home", defaultModel: { providerId: "claude", model: "opus", reasoningLevel: null, modelName: "Opus 5.5" } }, run: null };
  await act(async () => { root.render(<NewConversationPage botId="home" projectId="proj_personal" />); });
  expect(state.composer!.props).toMatchObject({ defaultProviderId: "claude", defaultModel: "opus" });
});

it("shows no composer for a Bot that does not exist", async () => {
  state.bot = { bot: null, run: null };
  await act(async () => { root.render(<NewConversationPage botId="gone" projectId={null} />); });
  expect(host.querySelector('[data-testid="composer"]')).toBeNull();
  expect(host.textContent).toContain("No Bot");
});

it("is a start page: no background of its own, the composer centered, and no page card under a scene theme", async () => {
  state.bot = null;
  await act(async () => { root.render(<NewConversationPage botId="home" projectId={null} />); });
  const page = host.querySelector('[data-testid="new-conversation-page"]')!;
  expect(page.hasAttribute("data-studio-start-page")).toBe(true);
  expect(page.className).not.toMatch(/(^|\s)bg-/);
  expect(host.querySelector('[data-testid="composer"]')!.parentElement!.className).toContain("justify-center");
  expect(START_PAGE_CSS).toContain('[data-sidebar="inset"]');
  expect(START_PAGE_CSS).toContain(":has([data-studio-start-page]) { background: none;");
  expect(START_PAGE_CSS).toContain("backdrop-filter: none; box-shadow: none;");
});
