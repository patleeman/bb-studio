import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  getPluginMarketplace,
  listPluginMarketplaces,
  upsertPluginMarketplace,
  type DbConnection,
} from "@bb/db";
import { CURATED_PLUGIN_MARKETPLACE_NAME } from "@bb/server-contract";
import { BUNDLED_MARKETPLACE_NAME } from "./bundled-marketplace-paths.js";
import { CURATED_MARKETPLACE_V2_URL } from "./marketplace-manifest.js";
import {
  marketplaceSourceColumns,
  parseMarketplaceSource,
} from "./marketplace-source.js";

export const STUDIO_MARKETPLACE_NAME = "bb-studio";
export const STUDIO_MARKETPLACE_SOURCE =
  "git:github.com/patleeman/bb-studio@stable";
const SEEDED_MARKER = "studio-default-added";

export function shipsCuratedMarketplace(marketplaceUrl: string): boolean {
  return marketplaceUrl !== "";
}

export function curatedSourceUrl(marketplaceUrl: string): string {
  return shipsCuratedMarketplace(marketplaceUrl)
    ? marketplaceUrl
    : CURATED_MARKETPLACE_V2_URL;
}

export function isShippedMarketplace(
  name: string,
  marketplaceUrl: string,
): boolean {
  return (
    name === BUNDLED_MARKETPLACE_NAME ||
    (name === CURATED_PLUGIN_MARKETPLACE_NAME &&
      shipsCuratedMarketplace(marketplaceUrl))
  );
}

export function seedStudioMarketplace(deps: {
  db: DbConnection;
  dataDir: string;
}): void {
  const marker = join(deps.dataDir, "marketplaces", SEEDED_MARKER);
  if (existsSync(marker)) return;
  if (getPluginMarketplace(deps.db, STUDIO_MARKETPLACE_NAME) === undefined) {
    upsertPluginMarketplace(deps.db, {
      name: STUDIO_MARKETPLACE_NAME,
      ...marketplaceSourceColumns(
        parseMarketplaceSource(STUDIO_MARKETPLACE_SOURCE, null),
      ),
      sourceGitCommit: null,
      manifestJson: JSON.stringify({
        schemaVersion: 1,
        name: STUDIO_MARKETPLACE_NAME,
        displayName: "BB Studio",
        plugins: [],
      }),
      statsJson: null,
      etag: null,
      lastModified: null,
      lastSuccessfulRefreshAt: null,
      lastAttemptedRefreshAt: null,
      lastError: null,
    });
  }
  mkdirSync(join(deps.dataDir, "marketplaces"), { recursive: true });
  writeFileSync(marker, `${new Date().toISOString()}\n`);
}

export function refreshAnchor(db: DbConnection): number | null {
  const curated = getPluginMarketplace(db, CURATED_PLUGIN_MARKETPLACE_NAME);
  if (curated !== undefined) return curated.lastAttemptedRefreshAt;
  let latest: number | null = null;
  for (const row of listPluginMarketplaces(db)) {
    if (row.lastAttemptedRefreshAt === null) continue;
    latest = Math.max(latest ?? 0, row.lastAttemptedRefreshAt);
  }
  return latest;
}
