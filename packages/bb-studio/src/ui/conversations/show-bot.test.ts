// @vitest-environment jsdom
// "Studio: Show the Bot": the current Bot's last conversation, else its Main.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { showBot } from "./show-bot";
import { hasLanded, rememberConversation, resetSidebarState, setCurrentBot, setThreadOpener } from "./state";

beforeEach(() => resetSidebarState());
afterEach(() => { resetSidebarState(); document.body.innerHTML = ""; });

const spaces = async () => ({ bots: [{ id: "cos", mainThreadId: "main" }, { id: "home", mainThreadId: "home_main" }], currentBotId: "cos" });

it("opens the current Bot's last conversation, else its Main", async () => {
  const open = vi.fn();
  await showBot(spaces, open);
  expect(open).toHaveBeenLastCalledWith("main");
  setCurrentBot("home");
  rememberConversation("home", "trip");
  await showBot(spaces, open);
  expect(open).toHaveBeenLastCalledWith("trip");
});

it("opens the thread with the sidebar's BB navigation when it is mounted, and counts as the window's landing", async () => {
  const viaSidebar = vi.fn();
  setThreadOpener(viaSidebar);
  await showBot(spaces);
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
  await showBot(spaces, vi.fn());
  expect(pressed).toHaveBeenCalledTimes(1);
});

it("opens nothing when there is no Bot", async () => {
  const open = vi.fn();
  await showBot(async () => ({ bots: [], currentBotId: null }), open);
  expect(open).not.toHaveBeenCalled();
});
