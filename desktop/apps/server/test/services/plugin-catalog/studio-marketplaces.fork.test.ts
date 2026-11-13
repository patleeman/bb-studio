import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPluginMarketplace, type DbConnection } from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPluginCatalogService } from "../../../src/services/plugin-catalog/plugin-catalog-service.js";
import { refreshAnchor } from "../../../src/services/plugin-catalog/studio-marketplaces.fork.js";
import type { MarketplaceFetch } from "../../../src/services/plugin-catalog/marketplace-http.js";

const GETBB_URL = "https://getbb.app/marketplace/v2/marketplace.json";

const getbbCatalog = {
  schemaVersion: 1,
  name: "bb-community",
  displayName: "BB Community",
  plugins: [],
};

describe("BB Studio's default marketplaces", () => {
  let db: DbConnection;
  let dataDir: string;
  let fetched: string[];

  beforeEach(async () => {
    db = createMigratedConnection();
    dataDir = await mkdtemp(join(tmpdir(), "bb-studio-marketplaces-"));
    fetched = [];
  });

  afterEach(async () => {
    db.$client.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  const fetch: MarketplaceFetch = async (url) => {
    fetched.push(url);
    return url === GETBB_URL
      ? Response.json(getbbCatalog)
      : new Response("not found", { status: 404 });
  };

  function service(marketplaceUrl: string) {
    return createPluginCatalogService({
      db,
      appVersion: "1.0.0",
      marketplaceUrl,
      dataDir,
      bundledPlugins: [],
      fetch,
      plugins: {
        installOfficialPlugin: async () => {
          throw new Error("unexpected install");
        },
        installCatalogPlugin: async () => {
          throw new Error("unexpected install");
        },
        resolveCatalogNpmSource: async () => {
          throw new Error("unexpected npm source");
        },
      },
    });
  }

  const names = (catalog: ReturnType<typeof service>) =>
    catalog.listMarketplaces().map((row) => row.name);

  it("lists BB Studio's catalog and not bb's Community catalog on a fresh install, and fetches nothing", () => {
    const catalog = service("");
    expect(names(catalog)).toEqual(["bb-official", "bb-studio"]);
    expect(getPluginMarketplace(db, "bb-studio")).toMatchObject({
      sourceKind: "git",
      manifestUrl: "https://github.com/patleeman/bb-studio",
      sourceGitRef: "stable",
    });
    expect(getPluginMarketplace(db, "bb-community")).toBeUndefined();
    expect(fetched).toEqual([]);
  });

  it("adds BB Studio's catalog once, so a removed one stays removed", async () => {
    const catalog = service("");
    await catalog.removeMarketplace("bb-studio");
    expect(names(service(""))).toEqual(["bb-official"]);
  });

  it("lets bb's Community catalog be added and removed by hand", async () => {
    const catalog = service("");
    const added = await catalog.addMarketplace({
      source: GETBB_URL,
      subdirectory: null,
    });
    expect(added.name).toBe("bb-community");
    expect(names(catalog)).toEqual([
      "bb-official",
      "bb-community",
      "bb-studio",
    ]);
    await catalog.removeMarketplace("bb-community");
    expect(names(catalog)).toEqual(["bb-official", "bb-studio"]);
  });

  it("keeps an upgraded install's bb Community catalog, adds BB Studio's beside it, and lets it be removed", async () => {
    service(GETBB_URL);
    expect(getPluginMarketplace(db, "bb-community")).toBeDefined();
    const upgraded = service("");
    expect(names(upgraded)).toEqual([
      "bb-official",
      "bb-community",
      "bb-studio",
    ]);
    await upgraded.removeMarketplace("bb-community");
    expect(names(service(""))).toEqual(["bb-official", "bb-studio"]);
    expect(
      existsSync(join(dataDir, "marketplaces", "studio-default-added")),
    ).toBe(true);
  });

  it("keeps bb's behavior when a Community catalog URL is configured", async () => {
    const catalog = service(GETBB_URL);
    expect(names(catalog)).toEqual(["bb-official", "bb-community"]);
    await expect(catalog.removeMarketplace("bb-community")).rejects.toThrow(
      "cannot be removed",
    );
  });

  it("times the periodic refresh from the latest attempt when there is no Community catalog", () => {
    service("");
    const official = getPluginMarketplace(db, "bb-official");
    expect(refreshAnchor(db)).toBe(official?.lastAttemptedRefreshAt);
  });
});
