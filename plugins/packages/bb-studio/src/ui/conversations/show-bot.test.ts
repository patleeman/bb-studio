// @vitest-environment jsdom
// "Studio: Show the Bot": the current Bot's last conversation, else its Main.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../../kit/app/nav", () => ({ openAppPath: vi.fn() }));
const { showBot } = await import("./show-bot");
import { hasLanded, rememberConversation, resetSidebarState, setCurrentBot, setThreadOpener } from "./state";

beforeEach(() => { resetSidebarState(); gone.clear(); });
afterEach(() => { resetSidebarState(); document.body.innerHTML = ""; });

const spaces = async () => ({ bots: [{ id: "cos", mainThreadId: "main" }, { id: "home", mainThreadId: "home_main" }], currentBotId: "cos" });
const MAINS: Record<string, string> = { cos: "main", home: "home_main" };
const gone = new Set<string>();
const land = async ({ botId, last }: { botId: string; last: string | null }) => ({ threadId: [last, MAINS[botId] ?? null].find((id) => !!id && !gone.has(id)) ?? null });

it("opens the current Bot's last conversation, else its Main", async () => {
  const open = vi.fn();
  await showBot(spaces, land, open);
  expect(open).toHaveBeenLastCalledWith("main");
  setCurrentBot("home");
  rememberConversation("home", "trip");
  await showBot(spaces, land, open);
  expect(open).toHaveBeenLastCalledWith("trip");
});

it("opens the thread with the sidebar's BB navigation when it is mounted, and counts as the window's landing", async () => {
  const viaSidebar = vi.fn();
  setThreadOpener(viaSidebar);
  await showBot(spaces, land);
  expect(viaSidebar).toHaveBeenCalledWith("main");
  expect(hasLanded()).toBe(true);
});

it("unfolds BB's sidebar when it is shut", async () => {
  const trigger = document.createElement("button");
  trigger.dataset.sidebar = "trigger";
  trigger.setAttribute("aria-expanded", "false");
  const pressed = vi.fn();
  trigger.addEventListener("click", pressed);
  document.body.append(trigger);
  await showBot(spaces, land, vi.fn());
  expect(pressed).toHaveBeenCalledTimes(1);
});

it("opens nothing when there is no Bot", async () => {
  const open = vi.fn();
  await showBot(async () => ({ bots: [], currentBotId: null }), land, open);
  expect(open).not.toHaveBeenCalled();
});

it("skips a deleted last conversation for Main, and opens the Bot's page when Main is gone too", async () => {
  const { openAppPath } = await import("../../kit/app/nav");
  const open = vi.fn();
  setCurrentBot("home");
  rememberConversation("home", "trip");
  gone.add("trip");
  await showBot(spaces, land, open);
  expect(open).toHaveBeenLastCalledWith("home_main");
  gone.add("home_main");
  open.mockClear();
  await showBot(spaces, land, open);
  expect(open).not.toHaveBeenCalled();
  expect(openAppPath).toHaveBeenCalledWith("/plugins/studio/studio/bot/home");
});
