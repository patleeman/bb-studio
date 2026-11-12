import { afterEach, expect, it, vi } from "vitest";
import { defaultAppearance } from "../appearance";
import { NORD } from "../builtin/classic";
import { GRID } from "../builtin/grid";
import { createThemeRegistry } from "../registry";
import { appearanceFor, appliedAppearance, canSwitchTheme, cycledChoice, cycleTheme, gridMove, popoverGroups, saveTheme, setThemeQuickRuntime, themeChoices, themeCommandRegistrations } from "./quick";
import { appearanceOverrides, forgetSavedAppearance, shownAppearance } from "./state";

const registry = createThemeRegistry([{ ...structuredClone(GRID), id: "after-dark", name: "After Dark" }, { ...structuredClone(NORD), id: "fjord", name: "Fjord" }]);
const choices = themeChoices(registry);
const mine = { ...defaultAppearance(GRID), intensity: 0.31, glass: 0.44, motion: 0.12, effects: { workers: false, finished: true, needsYou: false, error: true } };

afterEach(() => { forgetSavedAppearance(["cos", "home"]); setThemeQuickRuntime(null); });

it("lists the scene themes, then the classic ones, then None, with agent-made themes marked", () => {
  const kinds = choices.map((choice) => choice.group);
  expect(kinds.lastIndexOf("scene")).toBeLessThan(kinds.indexOf("classic"));
  expect(choices.at(-1)).toMatchObject({ id: null, name: "None" });
  expect(choices.map((choice) => choice.id).slice(0, -1)).toEqual([...registry.scenes(), ...registry.classics()].map((entry) => entry.theme.id));
  expect(choices.filter((choice) => choice.custom).map((choice) => choice.id)).toEqual(["after-dark", "fjord"]);
  const groups = popoverGroups(choices);
  expect(groups.map((group) => group.label)).toEqual(["Scene", "Classic"]);
  expect(groups[1]!.choices[0]!.name).toBe("None");
  expect(groups[1]!.choices.at(-1)!.id).toBe("fjord");
});

it("keeps the sliders and switches on the same theme, and takes a new theme's defaults with the Bot's switches", () => {
  expect(appearanceFor(mine, GRID)).toBe(mine);
  expect(appearanceFor(mine, NORD)).toEqual({ ...defaultAppearance(NORD), effects: mine.effects });
  expect(appearanceFor(null, NORD)).toEqual(defaultAppearance(NORD));
  expect(appearanceFor(mine, null)).toBeNull();
});

it("cycles in the picker's order and wraps both ways", () => {
  const ids = choices.map((choice) => choice.id);
  expect(cycledChoice(choices, ids[0]!, 1)!.id).toBe(ids[1]);
  expect(cycledChoice(choices, ids.at(-2)!, 1)!.id).toBeNull();
  expect(cycledChoice(choices, null, 1)!.id).toBe(ids[0]);
  expect(cycledChoice(choices, ids[0]!, -1)!.id).toBeNull();
  expect(cycledChoice(choices, "gone", 1)!.id).toBe(ids[0]);
});

it("shows an applied theme before the write lands and takes it back when the write fails", async () => {
  const bot = { id: "cos", appearance: mine };
  let finish!: () => void;
  const save = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  const done = saveTheme({ bot, themeId: "nord", registry, save });
  expect(shownAppearance(bot, appearanceOverrides())).toEqual({ ...defaultAppearance(NORD), effects: mine.effects });
  expect(save).toHaveBeenCalledWith("cos", { ...defaultAppearance(NORD), effects: mine.effects });
  finish();
  expect(await done).toBe(true);
  forgetSavedAppearance(["cos"]);
  await expect(saveTheme({ bot, themeId: null, registry, save: async () => { throw new Error("offline"); } })).rejects.toThrow("offline");
  expect(appliedAppearance(bot)).toEqual(mine);
  const unchanged = vi.fn(async () => {});
  expect(await saveTheme({ bot, themeId: "grid", registry, save: unchanged })).toBe(true);
  expect(await saveTheme({ bot, themeId: "gone", registry, save: unchanged })).toBe(false);
  expect(unchanged).not.toHaveBeenCalled();
});

it("registers Next theme on Ctrl+Option+T and Previous theme on Ctrl+Option+Shift+T, cycling the Bot on screen from its latest applied theme", async () => {
  const commands = themeCommandRegistrations();
  expect(commands.map((command) => [command.id, command.title, command.defaultShortcut])).toEqual([
    ["theme-next", "Studio: Next theme", { key: "t", control: true, alt: true }],
    ["theme-previous", "Studio: Previous theme", { key: "t", control: true, alt: true, shift: true }],
  ]);
  expect(commands.map((command) => command.isAvailable())).toEqual([false, false]);
  const save = vi.fn(async (_botId: string, _appearance: unknown) => {});
  const ids = choices.map((choice) => choice.id);
  setThemeQuickRuntime({ bots: [{ id: "cos", appearance: defaultAppearance(registry.get(ids[0]!)!) }, { id: "home", appearance: null }], shownBotId: "cos", registry, save });
  expect(canSwitchTheme()).toBe(true);
  await commands[0]!.run();
  await commands[0]!.run();
  expect(save.mock.calls.map(([botId, appearance]) => [botId, (appearance as { themeId: string } | null)?.themeId])).toEqual([["cos", ids[1]], ["cos", ids[2]]]);
  await commands[1]!.run();
  expect(save.mock.lastCall![1]).toMatchObject({ themeId: ids[1] });
  expect(await cycleTheme(1)).toBe(true);
  setThemeQuickRuntime({ bots: [], shownBotId: null, registry, save });
  expect(await cycleTheme(1)).toBe(false);
});

it("moves by arrows across a three-column grid of two groups", () => {
  const sizes = [5, 4];
  expect(gridMove(sizes, 0, "ArrowRight")).toBe(1);
  expect(gridMove(sizes, 0, "ArrowLeft")).toBe(0);
  expect(gridMove(sizes, 8, "ArrowRight")).toBe(8);
  expect(gridMove(sizes, 4, "ArrowRight")).toBe(5);
  expect(gridMove(sizes, 1, "ArrowDown")).toBe(4);
  expect(gridMove(sizes, 2, "ArrowDown")).toBe(4);
  expect(gridMove(sizes, 4, "ArrowDown")).toBe(6);
  expect(gridMove(sizes, 6, "ArrowDown")).toBe(8);
  expect(gridMove(sizes, 8, "ArrowDown")).toBe(8);
  expect(gridMove(sizes, 8, "ArrowUp")).toBe(5);
  expect(gridMove(sizes, 5, "ArrowUp")).toBe(3);
  expect(gridMove(sizes, 7, "ArrowUp")).toBe(4);
  expect(gridMove(sizes, 1, "ArrowUp")).toBe(1);
});
