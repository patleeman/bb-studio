import { expect, it, vi } from "vitest";
import { effectiveSettings } from "../settings/schema";
import { appCommandEntries, studioCommandEntries, type AppCommand, type StudioCommandRunners } from "./commands";

const command = (id: string, title: string, group: string, shortcut?: string): AppCommand => ({ id, title, group, ...(shortcut ? { shortcut } : {}), run: vi.fn() });

it("lists BB's commands under Commands and its settings pages under Settings, with their group and shortcut, leaving out Search and Studio's own titles", async () => {
  const commands = [
    command("app:thread.new", "New conversation", "Threads", "⌘N"),
    command("app:thread.search", "Search", "Threads", "⌘K"),
    command("app:window.new", "New window", "Window and layout", "⇧⌘N"),
    command("settings:general", "General settings", "Settings"),
    command("plugin:studio/handsfree", "Studio: Hands-free voice", "Plugins"),
    command("server:home", "Switch to Home server", "Servers"),
  ];
  const ran: string[] = [];
  const entries = appCommandEntries(commands, [{ title: "New Conversation" }], (each) => { ran.push(each.id); });
  expect(entries.map((each) => [each.title, each.section, each.detail, each.shortcut])).toEqual([
    ["New window", "commands", "Window and layout", "⇧⌘N"],
    ["General settings", "settings", "Settings", undefined],
    ["Studio: Hands-free voice", "commands", "Plugins", undefined],
    ["Switch to Home server", "commands", "Servers", undefined],
  ]);
  await entries[0]!.run();
  expect(ran).toEqual(["app:window.new"]);
  await appCommandEntries(commands, [])[0]!.run();
  expect(commands[0]!.run).toHaveBeenCalledTimes(1);
});

it("Studio's own: a switch to each other Bot, each settings section and a toggle for each on/off setting", async () => {
  const runners: StudioCommandRunners = { switchBot: vi.fn(), openSettings: vi.fn(), setSetting: vi.fn(async () => {}) };
  const settings = { ...effectiveSettings({}), loopsEnabled: false, autoResumeThreads: true };
  const entries = studioCommandEntries({ bots: [{ id: "dot", name: "Chief of Staff" }, { id: "home", name: "Home" }], currentBotId: "dot", settings, windows: true }, runners);
  const byTitle = (title: string) => entries.find((each) => each.title === title)!;
  expect(entries.filter((each) => each.section === "actions").map((each) => each.title)).toEqual(["Switch to Home"]);
  expect(entries.some((each) => each.title === "Switch to Chief of Staff")).toBe(false);
  await byTitle("Switch to Home").run();
  expect(runners.switchBot).toHaveBeenCalledWith("home");
  expect(entries.filter((each) => each.key.startsWith("studio:settings:")).map((each) => each.title)).toEqual([
    "Studio settings: Voice", "Studio settings: Recordings and calls", "Studio settings: Agent replies", "Studio settings: Threads", "Studio settings: Windows", "Studio settings: Smart Queue model", "Studio settings: Advanced",
  ]);
  await byTitle("Studio settings: Voice").run();
  expect(runners.openSettings).toHaveBeenCalledWith("voice");
  expect([byTitle("Resume after a restart").detail, byTitle("Todo reminders").detail]).toEqual(["On", "Off"]);
  await byTitle("Resume after a restart").run();
  await byTitle("Todo reminders").run();
  expect(vi.mocked(runners.setSetting).mock.calls).toEqual([["autoResumeThreads", false], ["loopsEnabled", true]]);
  expect(entries.some((each) => /hud/i.test(each.title) || /hud/i.test(each.key))).toBe(false);
  const bare = studioCommandEntries({ bots: [], currentBotId: null, settings: null, windows: false }, runners);
  expect(bare.some((each) => each.title === "Studio settings: Windows")).toBe(false);
  expect(bare.every((each) => each.section === "settings")).toBe(true);
});

it("themes: Next theme and Previous theme with their shortcuts, then Theme: <name> for each in the picker's order, ending with None", async () => {
  const runners: StudioCommandRunners = { switchBot: vi.fn(), openSettings: vi.fn(), setSetting: vi.fn(async () => {}), applyTheme: vi.fn(), cycleTheme: vi.fn() };
  const input = { bots: [{ id: "dot", name: "Chief of Staff" }], currentBotId: "dot", settings: null, windows: false };
  const themes = [{ id: "miami", name: "Miami" }, { id: "nord", name: "Nord" }, { id: null, name: "None" }];
  const entries = studioCommandEntries({ ...input, themes, themeShortcuts: { next: "⌃⌥T", previous: "⌃⌥⇧T" } }, runners);
  const own = entries.filter((each) => each.key.startsWith("studio:theme"));
  expect(own.map((each) => [each.key, each.title, each.shortcut])).toEqual([
    ["studio:theme-next", "Next theme", "⌃⌥T"],
    ["studio:theme-previous", "Previous theme", "⌃⌥⇧T"],
    ["studio:theme:miami", "Theme: Miami", undefined],
    ["studio:theme:nord", "Theme: Nord", undefined],
    ["studio:theme:none", "Theme: None", undefined],
  ]);
  expect(own.every((each) => each.section === "actions")).toBe(true);
  expect(own.map((each) => each.order)).toEqual([...own.map((each) => each.order)].sort((a, b) => a! - b!));
  for (const each of own) await each.run();
  expect(vi.mocked(runners.cycleTheme!).mock.calls).toEqual([[1], [-1]]);
  expect(vi.mocked(runners.applyTheme!).mock.calls).toEqual([["miami"], ["nord"], [null]]);
  expect(studioCommandEntries(input, runners).some((each) => each.key.startsWith("studio:theme"))).toBe(false);
  expect(studioCommandEntries({ ...input, themes }, { ...runners, applyTheme: undefined }).some((each) => each.key.startsWith("studio:theme"))).toBe(false);
});
