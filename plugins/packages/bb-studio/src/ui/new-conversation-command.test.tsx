// @vitest-environment jsdom
import { expect, it, vi } from "vitest";

const openFrom = vi.fn();
vi.mock("./studio-open", async (original) => ({ ...(await original<object>()), openFrom }));

const { startNewConversation } = await import("./tab-kind-tabs");
const { setCurrentBot } = await import("./conversations/state");
const { registerNewConversation } = await import("../kit/app/host-sdk");

it("BB's Mod+N starts a new conversation with the Bot the sidebar shows", () => {
  setCurrentBot("bot_juniper");
  expect(startNewConversation()).toBe(true);
  expect(openFrom).toHaveBeenCalledWith(null, { href: "/plugins/studio/studio/new-conversation/bot_juniper" }, { target: "main" }, expect.anything());
});

it("registers the handler only on a BB that has the slot", () => {
  const registered: unknown[] = [];
  const run = () => true;
  expect(registerNewConversation({ experimental_newConversation: (registration: unknown) => { registered.push(registration); } }, { id: "bot", run })).toBe(true);
  expect(registered).toEqual([{ id: "bot", run }]);
  expect(registerNewConversation({}, { id: "bot", run })).toBe(false);
});
