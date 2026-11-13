import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getPluginMarketplace,
  upsertPluginMarketplace,
  type DbConnection,
} from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPluginCatalogService } from "../../../src/services/plugin-catalog/plugin-catalog-service.js";
import { refreshAnchor } from "../../../src/services/plugin-catalog/studio-marketplaces.fork.js";
import type { MarketplaceFetch } from "../../../src/services/plugin-catalog/marketplace-http.js";

const GETBB_URL = "https://getbb.app/marketplace/v2/marketplace.json";
const STUDIO_URL =
  "https://raw.githubusercontent.com/patleeman/bb-studio/stable/marketplace.json";
const MOBILE_ICON_URL =
  "https://raw.githubusercontent.com/patleeman/bb-studio/stable/plugins/packages/bb-studio-mobile/icons/mobile.svg";
const SVG = new Uint8Array(
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M0 0h16v16H0z"/></svg>',
  ),
);

const studioEntry = (id: string, subdir: string, icon: unknown) => ({
  id,
  displayName: id,
  description: `${id} plugin.`,
  icon,
  tags: ["bb-studio"],
  author: { name: "Studio", github: "studio" },
  source: {
    git: {
      url: "https://github.com/patleeman/bb-studio.git",
      subdir,
      ref: "stable",
    },
  },
});

const studioCatalog = {
  schemaVersion: 1,
  name: "bb-studio",
  displayName: "BB Studio",
  plugins: [
    studioEntry("studio", "plugins/packages/bb-studio", "Home"),
    studioEntry("mobile", "plugins/packages/bb-studio-mobile", {
      url: "./plugins/packages/bb-studio-mobile/icons/mobile.svg",
    }),
    studioEntry(
      "studio-visual-chat",
      "plugins/packages/bb-studio-visual-chat",
      "Chat",
    ),
  ],
};

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
    if (url === GETBB_URL) return Response.json(getbbCatalog);
    if (url === STUDIO_URL) {
      return new Response(JSON.stringify(studioCatalog), {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8", etag: '"v1"' },
      });
    }
    if (url === MOBILE_ICON_URL) {
      return new Response(SVG, {
        status: 200,
        headers: { "content-type": "image/svg+xml" },
      });
    }
    return new Response("not found", { status: 404 });
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
      sourceKind: "https",
      manifestUrl: STUDIO_URL,
      sourceGitRef: null,
      lastAttemptedRefreshAt: null,
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

  it("fetches BB Studio's catalog over https at launch, resolves its icons, and leaves out the built-in plugins", async () => {
    const catalog = service("");
    catalog.startPeriodicRefresh();
    try {
      await expect
        .poll(
          () => getPluginMarketplace(db, "bb-studio")?.lastSuccessfulRefreshAt,
        )
        .not.toBeNull();
    } finally {
      catalog.stopPeriodicRefresh();
    }
    const row = getPluginMarketplace(db, "bb-studio");
    expect(row?.lastError).toBeNull();
    expect(row?.etag).toBe('"v1"');
    const stored = JSON.parse(row?.manifestJson ?? "{}") as {
      plugins: { id: string; source: unknown }[];
    };
    expect(stored.plugins.map((entry) => entry.id)).toEqual(["mobile"]);
    expect(stored.plugins[0]?.source).toEqual({
      git: {
        url: "https://github.com/patleeman/bb-studio.git",
        subdir: "plugins/packages/bb-studio-mobile",
        ref: "stable",
      },
    });
    expect(fetched).toContain(STUDIO_URL);
    expect(fetched).toContain(MOBILE_ICON_URL);
    expect(fetched.some((url) => url.includes("getbb.app"))).toBe(false);
    await expect(
      catalog.installPlan({ entryId: "studio", marketplace: "bb-studio" }),
    ).rejects.toThrow();
    const plan = await catalog.installPlan({
      entryId: "mobile",
      marketplace: "bb-studio",
    });
    expect(plan.kind).toBe("marketplace");
  });

  it("moves a BB Studio catalog added from git onto its https file, keeping its ref", () => {
    upsertPluginMarketplace(db, {
      name: "bb-studio",
      sourceKind: "git",
      manifestUrl: "https://github.com/patleeman/bb-studio",
      sourceGitRef: "main",
      sourceGitSubdirectory: null,
      sourceGitCommit: "abc",
      manifestJson: JSON.stringify(studioCatalog),
      statsJson: null,
      etag: null,
      lastModified: null,
      lastSuccessfulRefreshAt: 5,
      lastAttemptedRefreshAt: 5,
      lastError: null,
    });
    service("");
    expect(getPluginMarketplace(db, "bb-studio")).toMatchObject({
      sourceKind: "https",
      manifestUrl:
        "https://raw.githubusercontent.com/patleeman/bb-studio/main/marketplace.json",
      sourceGitRef: null,
      sourceGitCommit: null,
      lastAttemptedRefreshAt: null,
    });
  });

  it("times the periodic refresh from the catalogs it fetches: a never-fetched one is due now", () => {
    service("");
    expect(refreshAnchor(db)).toBeNull();
    const studio = getPluginMarketplace(db, "bb-studio");
    if (studio === undefined) throw new Error("expected bb-studio");
    upsertPluginMarketplace(db, { ...studio, lastAttemptedRefreshAt: 2_000 });
    expect(refreshAnchor(db)).toBe(2_000);
  });

  it("schedules the next refresh 2 hours out when only the built-in catalog is left", async () => {
    const catalog = service("");
    await catalog.removeMarketplace("bb-studio");
    const before = Date.now();
    expect(refreshAnchor(db)).toBeGreaterThanOrEqual(before);
  });
});
