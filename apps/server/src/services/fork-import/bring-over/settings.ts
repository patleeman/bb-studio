import type Database from "better-sqlite3";
import { lstat, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { customProviderModelSchema } from "@bb/config/bb-app-managed-config";
import { mutateManagedJsonFile } from "@bb/config/managed-json-file";
import { quote, selectList, sharedColumns } from "../sync.js";
import {
  BringOverError,
  copyFileIfMissing,
  copyMissingTree,
  exists,
} from "./files.js";

type Sqlite = Database.Database;
type Row = Record<string, unknown>;

export type SettingId =
  | "preferences"
  | "app-settings"
  | "theme"
  | "instructions"
  | "skills"
  | "custom-models"
  | "env";

export interface SettingItem {
  id: SettingId;
  label: string;
  detail: string;
  secret: boolean;
  count: number;
  names?: string[];
  alreadyHere?: string[];
}

const SKIPPED_APP_SETTING_KEYS = new Set([
  "pluginSafeMode",
  "appUpdateSendHold",
  "skippedAppUpdate",
]);

const SKIPPED_PREFERENCE_KEYS = new Set([
  "sidebar.pluginPanelOrder",
  "sidebar.visiblePluginPanels",
  "sidebar.hiddenFooterItems",
  "sidebar.footerOrder",
]);

async function readJsonObject(
  path: string,
): Promise<Record<string, unknown> | null> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function envNamesHere(
  dataDir: string,
  names: readonly string[],
): Promise<string[]> {
  const mine = await readJsonObject(join(dataDir, "env.json"));
  const env =
    typeof mine?.env === "object" && mine.env !== null
      ? (mine.env as Record<string, unknown>)
      : {};
  return names.filter((name) => name in env).sort();
}

async function isLink(path: string): Promise<boolean> {
  const stats = await lstat(path).catch(() => null);
  return stats?.isSymbolicLink() === true;
}

function count(source: Sqlite, sql: string): number {
  try {
    return source.prepare<[], { count: number }>(sql).get()?.count ?? 0;
  } catch {
    return 0;
  }
}

export async function listSettings(
  source: Sqlite,
  sourceDataDir: string,
  dataDir: string | null = null,
): Promise<SettingItem[]> {
  const items: SettingItem[] = [];
  const preferences = count(
    source,
    "SELECT COUNT(*) AS count FROM ui_preferences",
  );
  if (preferences > 0) {
    items.push({
      id: "preferences",
      label: "Display preferences",
      detail: "Sorting, grouping and other choices made in bb's interface.",
      secret: false,
      count: preferences,
    });
  }
  items.push({
    id: "app-settings",
    label: "App settings",
    detail:
      "Switches from bb's Settings, such as keyboard hints and provider memory.",
    secret: false,
    count:
      count(source, "SELECT COUNT(*) AS count FROM app_settings") +
      count(source, "SELECT COUNT(*) AS count FROM app_settings_values"),
  });
  const themeRows = count(source, "SELECT COUNT(*) AS count FROM app_theme");
  const themeLink = await isLink(join(sourceDataDir, "theme"));
  if (themeRows > 0 || (await exists(join(sourceDataDir, "theme")))) {
    items.push({
      id: "theme",
      label: "Theme",
      detail: themeLink
        ? "bb's chosen theme. Its theme folder is a link to another folder and is not copied."
        : "bb's chosen theme and its theme files.",
      secret: false,
      count: themeRows,
    });
  }
  if (await exists(join(sourceDataDir, "AGENTS.md"))) {
    items.push({
      id: "instructions",
      label: "Global agent instructions",
      detail: "The AGENTS.md file bb gives every agent.",
      secret: false,
      count: 1,
    });
  }
  const skillsDir = join(sourceDataDir, "skills");
  const skills = await readdir(skillsDir).catch(() => []);
  if (await isLink(skillsDir)) {
    items.push({
      id: "skills",
      label: "Skills",
      detail:
        "bb's skills folder is a link to another folder and is not copied.",
      secret: false,
      count: 0,
    });
  } else if (skills.length > 0) {
    items.push({
      id: "skills",
      label: "Skills",
      detail: "Skills in bb's skills folder.",
      secret: false,
      count: skills.length,
    });
  }
  const config = await readJsonObject(join(sourceDataDir, "config.json"));
  const models = Array.isArray(config?.customModels) ? config.customModels : [];
  if (models.length > 0) {
    items.push({
      id: "custom-models",
      label: "Custom models",
      detail: "Models added by hand. Used after BB Studio restarts.",
      secret: false,
      count: models.length,
    });
  }
  const env = await readJsonObject(join(sourceDataDir, "env.json"));
  const variables =
    typeof env?.env === "object" && env.env !== null
      ? Object.keys(env.env)
      : [];
  if (variables.length > 0) {
    items.push({
      id: "env",
      label: "Environment variables",
      detail:
        "Values bb passes to agents. May hold API keys and tokens. Used after BB Studio restarts.",
      secret: true,
      count: variables.length,
      names: [...variables].sort(),
      alreadyHere:
        dataDir === null ? [] : await envNamesHere(dataDir, variables),
    });
  }
  return items;
}

function copyKeyedRows(
  source: Sqlite,
  target: Sqlite,
  table: string,
  replace: boolean,
  keep: (row: Row) => boolean = () => true,
): number {
  const columns = sharedColumns(source, target, table);
  if (columns.length === 0) return 0;
  const rows = source
    .prepare<[], Row>(`SELECT ${selectList(columns)} FROM ${quote(table)}`)
    .all()
    .filter(keep);
  const insert = target.prepare(
    `INSERT OR ${replace ? "REPLACE" : "IGNORE"} INTO ${quote(table)} (${selectList(columns)}) VALUES (${columns.map((column) => `@${column}`).join(", ")})`,
  );
  let changed = 0;
  target.transaction(() => {
    for (const row of rows) changed += insert.run(row).changes;
  })();
  return changed;
}

async function replaceFile(from: string, to: string): Promise<void> {
  const temp = `${to}.import-tmp`;
  await writeFile(temp, await readFile(from));
  await rename(temp, to);
}

export async function applySetting(args: {
  id: SettingId;
  replace: boolean;
  source: Sqlite;
  target: Sqlite;
  sourceDataDir: string;
  dataDir: string;
}): Promise<void> {
  const { source, target, replace } = args;
  switch (args.id) {
    case "preferences":
      copyKeyedRows(
        source,
        target,
        "ui_preferences",
        replace,
        (row) => !SKIPPED_PREFERENCE_KEYS.has(String(row.key)),
      );
      return;
    case "app-settings":
      copyKeyedRows(source, target, "app_settings", replace);
      copyKeyedRows(
        source,
        target,
        "app_settings_values",
        replace,
        (row) => !SKIPPED_APP_SETTING_KEYS.has(String(row.key)),
      );
      return;
    case "theme":
      copyKeyedRows(source, target, "app_theme", replace);
      await copyMissingTree(
        join(args.sourceDataDir, "theme"),
        join(args.dataDir, "theme"),
      );
      return;
    case "instructions": {
      const from = join(args.sourceDataDir, "AGENTS.md");
      const to = join(args.dataDir, "AGENTS.md");
      if (replace && (await exists(to))) await replaceFile(from, to);
      else await copyFileIfMissing(from, to);
      return;
    }
    case "skills":
      if (await isLink(join(args.sourceDataDir, "skills"))) {
        throw new BringOverError(
          "bb's skills folder is a link to another folder and is not copied",
        );
      }
      await copyMissingTree(
        join(args.sourceDataDir, "skills"),
        join(args.dataDir, "skills"),
      );
      return;
    case "custom-models": {
      const config = await readJsonObject(
        join(args.sourceDataDir, "config.json"),
      );
      const models = (
        Array.isArray(config?.customModels) ? config.customModels : []
      ).filter((model) => customProviderModelSchema.safeParse(model).success);
      await mutateManagedJsonFile<Record<string, unknown>>({
        path: join(args.dataDir, "config.json"),
        read: async () =>
          (await readJsonObject(join(args.dataDir, "config.json"))) ?? {},
        mutate: (current) => {
          const mine = Array.isArray(current.customModels)
            ? current.customModels
            : [];
          const seen = new Set(mine.map((model) => JSON.stringify(model)));
          const merged = replace
            ? models
            : [
                ...mine,
                ...models.filter((model) => !seen.has(JSON.stringify(model))),
              ];
          return { ...current, customModels: merged };
        },
      });
      return;
    }
    case "env": {
      const bb = await readJsonObject(join(args.sourceDataDir, "env.json"));
      if (bb === null)
        throw new BringOverError("bb's env.json could not be read");
      const theirs =
        typeof bb.env === "object" && bb.env !== null
          ? (bb.env as Record<string, unknown>)
          : {};
      await mutateManagedJsonFile<Record<string, unknown>>({
        path: join(args.dataDir, "env.json"),
        read: async () =>
          (await readJsonObject(join(args.dataDir, "env.json"))) ?? {},
        mutate: (current) => {
          const mine =
            typeof current.env === "object" && current.env !== null
              ? (current.env as Record<string, unknown>)
              : {};
          return {
            ...current,
            env: replace ? { ...mine, ...theirs } : { ...theirs, ...mine },
          };
        },
      });
      return;
    }
  }
}
