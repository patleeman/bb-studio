import { POP_OUT_LABEL } from "../hud/shared";
import { SETTINGS_GROUPS, STUDIO_SETTINGS, type SettingGroup, type StudioSettingKey, type StudioSettingValues } from "../settings/schema";
import type { LauncherEntry } from "./rank";

export interface RunnableEntry extends LauncherEntry {
  run(): void | Promise<void>;
}

export interface AppCommand {
  id: string;
  title: string;
  group: string;
  shortcut?: string;
  run(): void;
}

export const HIDDEN_APP_COMMANDS: ReadonlySet<string> = new Set(["app:thread.search", "app:palette.open"]);

const fold = (title: string) => title.trim().toLocaleLowerCase();

export function appCommandEntries(commands: readonly AppCommand[], taken: readonly { title: string }[], run: (command: AppCommand) => void | Promise<void> = (command) => command.run()): RunnableEntry[] {
  const titles = new Set(taken.map((each) => fold(each.title)));
  const seen = new Set<string>();
  return commands.flatMap((command) => {
    if (HIDDEN_APP_COMMANDS.has(command.id) || titles.has(fold(command.title)) || seen.has(command.id)) return [];
    seen.add(command.id);
    const settings = command.id.startsWith("settings:");
    return [{
      key: `bb:${command.id}`, title: command.title, icon: settings ? "SlidersHorizontal" : "CornerDownRight", section: settings ? "settings" as const : "commands" as const,
      keywords: [command.group], detail: command.group, ...(command.shortcut ? { shortcut: command.shortcut } : {}),
      run: () => run(command),
    }];
  });
}

export interface StudioCommandBot { id: string; name: string }

export interface StudioCommandTheme { id: string | null; name: string }

export interface StudioCommandInput {
  themes?: readonly StudioCommandTheme[];
  themeShortcuts?: { next?: string; previous?: string };
  bots: readonly StudioCommandBot[];
  currentBotId: string | null;
  popOutThreadId: string | null;
  settings: StudioSettingValues | null;
  windows: boolean;
}

export interface StudioCommandRunners {
  switchBot(botId: string): void | Promise<void>;
  popOut(threadId: string): void | Promise<void>;
  openSettings(group: SettingGroup): void | Promise<void>;
  setSetting(key: StudioSettingKey, value: boolean): Promise<void>;
  applyTheme?(themeId: string | null): void | Promise<void>;
  cycleTheme?(step: 1 | -1): void | Promise<void>;
}

const THEME_KEYWORDS = ["theme", "scene", "appearance"];

export function themeCommandEntries(input: Pick<StudioCommandInput, "themes" | "themeShortcuts">, runners: Pick<StudioCommandRunners, "applyTheme" | "cycleTheme">): RunnableEntry[] {
  const { applyTheme, cycleTheme } = runners;
  if (!input.themes?.length || !applyTheme || !cycleTheme) return [];
  const cycle = (key: string, title: string, step: 1 | -1, order: number, shortcut: string | undefined): RunnableEntry => ({
    key, title, icon: "Palette", section: "actions", keywords: THEME_KEYWORDS, order, ...(shortcut ? { shortcut } : {}), run: () => cycleTheme(step),
  });
  return [
    cycle("studio:theme-next", "Next theme", 1, 60, input.themeShortcuts?.next),
    cycle("studio:theme-previous", "Previous theme", -1, 61, input.themeShortcuts?.previous),
    ...input.themes.map((theme, index): RunnableEntry => ({
      key: `studio:theme:${theme.id ?? "none"}`, title: `Theme: ${theme.name}`, icon: "Palette", section: "actions", keywords: THEME_KEYWORDS, order: 62 + index,
      run: () => applyTheme(theme.id),
    })),
  ];
}

const BOOLEAN_KEYS = (Object.keys(STUDIO_SETTINGS) as StudioSettingKey[]).filter((key) => STUDIO_SETTINGS[key].type === "boolean");

export function studioCommandEntries(input: StudioCommandInput, runners: StudioCommandRunners): RunnableEntry[] {
  const groups = SETTINGS_GROUPS.filter((group) => group.id !== "windows" || input.windows);
  const titleOf = (group: SettingGroup) => SETTINGS_GROUPS.find((each) => each.id === group)?.title ?? "";
  const switches = input.bots.filter((bot) => bot.id !== input.currentBotId).map((bot, index): RunnableEntry => ({
    key: `studio:bot:${bot.id}`, title: `Switch to ${bot.name}`, icon: "Bot", section: "actions", keywords: ["bot", "space"], order: 30 + index,
    run: () => runners.switchBot(bot.id),
  }));
  const popOut: RunnableEntry[] = input.popOutThreadId ? [{
    key: "studio:pop-out-hud", title: POP_OUT_LABEL, icon: "AppWindow", section: "actions", keywords: ["hud", "window", "float"], order: 25,
    run: () => runners.popOut(input.popOutThreadId!),
  }] : [];
  const sections = groups.map((group): RunnableEntry => ({
    key: `studio:settings:${group.id}`, title: `Studio settings: ${group.title}`, icon: "SlidersHorizontal", section: "settings", keywords: ["settings", "preferences"],
    run: () => runners.openSettings(group.id),
  }));
  const toggles = input.settings ? BOOLEAN_KEYS.filter((key) => groups.some((group) => group.id === STUDIO_SETTINGS[key].group)).map((key): RunnableEntry => {
    const on = input.settings![key] === true;
    return {
      key: `studio:setting:${key}`, title: STUDIO_SETTINGS[key].label, icon: "SlidersHorizontal", section: "settings", keywords: ["setting", "toggle", titleOf(STUDIO_SETTINGS[key].group)],
      detail: on ? "On" : "Off", run: () => runners.setSetting(key, !on),
    };
  }) : [];
  return [...popOut, ...switches, ...themeCommandEntries(input, runners), ...sections, ...toggles];
}
