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
import {
  CURATED_MARKETPLACE_V2_URL,
  type MarketplaceManifest,
} from "./marketplace-manifest.js";
import { FORK_BUNDLED_PLUGINS } from "../plugins/builtin-registry.fork.js";
import {
  marketplaceSourceColumns,
  parseMarketplaceSource,
} from "./marketplace-source.js";

export const STUDIO_MARKETPLACE_NAME = "bb-studio";
export const STUDIO_MARKETPLACE_SOURCE =
  "https://raw.githubusercontent.com/patleeman/bb-studio/stable/marketplace.json";
const STUDIO_REPO = /^https:\/\/github\.com\/patleeman\/bb-studio(\.git)?$/;
const SEEDED_MARKER = "studio-default-added";

export function shipsCuratedMarketplace(marketplaceUrl: string): boolean {
  return marketplaceUrl !== "";
}

export function curatedSourceUrl(marketplaceUrl: string): string {
  return shipsCuratedMarketplace(marketplaceUrl)
    ? marketplaceUrl
    : CURATED_MARKETPLACE_V2_URL;
}

let curatedShipped = true;

export function configureShippedMarketplaces(marketplaceUrl: string): void {
  curatedShipped = shipsCuratedMarketplace(marketplaceUrl);
}

export function isShippedMarketplace(name: string): boolean {
  return (
    name === BUNDLED_MARKETPLACE_NAME ||
    (name === CURATED_PLUGIN_MARKETPLACE_NAME && curatedShipped)
  );
}

export function seedStudioMarketplace(deps: {
  db: DbConnection;
  dataDir: string;
}): void {
  moveStudioMarketplaceOffGit(deps.db);
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

function moveStudioMarketplaceOffGit(db: DbConnection): void {
  const row = getPluginMarketplace(db, STUDIO_MARKETPLACE_NAME);
  if (
    row?.sourceKind !== "git" ||
    row.sourceGitSubdirectory !== null ||
    !STUDIO_REPO.test(row.manifestUrl)
  ) {
    return;
  }
  const ref = row.sourceGitRef ?? "stable";
  upsertPluginMarketplace(db, {
    name: row.name,
    ...marketplaceSourceColumns(
      parseMarketplaceSource(
        `https://raw.githubusercontent.com/patleeman/bb-studio/${ref}/marketplace.json`,
        null,
      ),
    ),
    sourceGitCommit: null,
    manifestJson: row.manifestJson,
    statsJson: row.statsJson,
    etag: null,
    lastModified: null,
    lastSuccessfulRefreshAt: row.lastSuccessfulRefreshAt,
    lastAttemptedRefreshAt: null,
    lastError: row.lastError,
  });
}

export function refreshAnchor(db: DbConnection): number | null {
  const curated = getPluginMarketplace(db, CURATED_PLUGIN_MARKETPLACE_NAME);
  if (curated !== undefined) return curated.lastAttemptedRefreshAt;
  const rows = listPluginMarketplaces(db).filter(
    (row) => row.name !== BUNDLED_MARKETPLACE_NAME,
  );
  if (rows.length === 0) return Date.now();
  let oldest = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    if (row.lastAttemptedRefreshAt === null) return null;
    oldest = Math.min(oldest, row.lastAttemptedRefreshAt);
  }
  return oldest;
}

export function withoutForkBuiltins<
  T extends { catalog: MarketplaceManifest; manifestJson: string },
>(materialized: T): T {
  const builtins = new Set(
    FORK_BUNDLED_PLUGINS.map((plugin) => plugin.pluginId),
  );
  const { catalog } = materialized;
  if (!catalog.plugins.some((entry) => builtins.has(entry.id))) {
    return materialized;
  }
  const filtered = {
    ...catalog,
    plugins: catalog.plugins.filter((entry) => !builtins.has(entry.id)),
  } as MarketplaceManifest;
  return {
    ...materialized,
    catalog: filtered,
    manifestJson: JSON.stringify(filtered),
  };
}
