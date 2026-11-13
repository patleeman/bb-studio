// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ bots: [] as { id: string; name: string; avatar: string; state: string; primary?: boolean; kind?: string }[] | null, open: vi.fn() }));
vi.mock("../live", () => ({ useLive: () => ({ data: state.bots ? { bots: state.bots } : undefined, refresh() {} }) }));
vi.mock("../../kit/app/index", () => ({
  GHOST_BUTTON: "", PRIMARY_BUTTON: "", Icon: () => null, openAppPath: state.open,
  PageColumn: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  StudioBar: ({ children }: { children: ReactNode }) => <div data-testid="studio-bar">{children}</div>,
}));
vi.mock("../../loops/ui/TodosPage", () => ({
  TodosPage: (props: { view: { bot: { id: string; name: string; state: string; kind?: string } }; focus?: string }) => <section data-testid="bot-automations" data-bot={props.view.bot.id} data-name={props.view.bot.name} data-disabled={String(props.view.bot.state !== "active")} data-external={String(props.view.bot.kind === "external")} data-focus={props.focus} />,
}));
vi.mock("../../kit/ui/icon", () => ({ Icon: () => null }));
vi.mock("../bot/BotAvatar", () => ({ BotAvatar: () => null, botProvider: () => null }));
vi.mock("../bot/workspace", () => ({ useOpenThread: () => () => {} }));

import { AutomationsPanel, shownBot } from "./AutomationsPanel";
import { resetSidebarState, setCurrentBot } from "../conversations/state";

let root: Root;
let container: HTMLElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); container = document.createElement("div"); document.body.append(container); root = createRoot(container); state.open.mockClear(); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); resetSidebarState(); });
const section = () => container.querySelector<HTMLElement>("[data-testid=bot-automations]");
const tabs = () => [...container.querySelectorAll<HTMLButtonElement>("[role=tab]")];

it("shows the picked Bot, else the primary, else the first", () => {
  const bots = [{ id: "a" }, { id: "b", primary: true }];
  expect(shownBot(bots, null)?.id).toBe("b");
  expect(shownBot(bots, "a")?.id).toBe("a");
  expect(shownBot([{ id: "a" }], "gone")?.id).toBe("a");
  expect(shownBot([], null)).toBeNull();
});

it("with one Bot, is that Bot's Todos page opened at Scheduled, full-page, with no switcher", async () => {
  state.bots = [{ id: "bot_main", name: "Chief of Staff", avatar: "🤖", state: "active", primary: true }];
  await act(async () => root.render(<AutomationsPanel />));
  expect(section()?.dataset).toMatchObject({ bot: "bot_main", disabled: "false", external: "false", focus: "scheduled" });
  expect(tabs()).toHaveLength(0);
});

it("with several Bots, shows the sidebar's Bot and follows it when the sidebar switches, with no switcher of its own", async () => {
  state.bots = [
    { id: "bot_ops", name: "Ops", avatar: "🛠", state: "paused", kind: "external" },
    { id: "bot_main", name: "Chief of Staff", avatar: "🤖", state: "active", primary: true },
  ];
  await act(async () => root.render(<AutomationsPanel />));
  expect(tabs()).toHaveLength(0);
  expect(section()?.dataset.bot).toBe("bot_main");
  await act(async () => setCurrentBot("bot_ops"));
  expect(section()?.dataset).toMatchObject({ bot: "bot_ops", disabled: "true", external: "true" });
});

it("with no Bot, says automations belong to a Bot and offers to make one", async () => {
  state.bots = [];
  await act(async () => root.render(<AutomationsPanel />));
  expect(section()).toBeNull();
  await act(async () => (container.querySelector("[data-testid=automations-empty] button") as HTMLButtonElement).click());
  expect(state.open).toHaveBeenCalledWith("/plugins/studio/studio/bot/new");
});

it("with no Bot, the template's header still names the page", async () => {
  state.bots = [];
  await act(async () => root.render(<AutomationsPanel />));
  expect(container.querySelectorAll("h1")).toHaveLength(1);
  expect(container.querySelector("[data-testid=studio-bar] [data-testid=page-bar-title]")?.textContent).toBe("Todos");
});

it("hands the shown Bot's name to the page, whose header names it", async () => {
  state.bots = [{ id: "bot_main", name: "Chief of Staff", avatar: "🤖", state: "active", primary: true }];
  await act(async () => root.render(<AutomationsPanel />));
  expect(section()?.dataset.name).toBe("Chief of Staff");
});
