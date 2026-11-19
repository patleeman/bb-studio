import { readFileSync } from "node:fs";
import { join } from "node:path";

export const OLD_PLUGINS_FILE_NAME = "fork-import-plugins.json";

export interface OldPlugin {
  id: string;
  version: string | null;
  source: string;
  sourceKind: string;
  enabled: boolean;
  catalog: { marketplace: string; entryId: string | null } | null;
  hadData: boolean;
}

export interface OldPluginsRecord {
  version: 1;
  sourceDataDir: string;
  plugins: OldPlugin[];
}

export function readOldPluginsRecord(dataDir: string): OldPluginsRecord | null {
  try {
    const value = JSON.parse(
      readFileSync(join(dataDir, OLD_PLUGINS_FILE_NAME), "utf8"),
    ) as Partial<OldPluginsRecord>;
    return value.version === 1 &&
      typeof value.sourceDataDir === "string" &&
      Array.isArray(value.plugins)
      ? (value as OldPluginsRecord)
      : null;
  } catch {
    return null;
  }
}
