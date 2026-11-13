import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { UpdateCheckResult } from "electron-updater";
import {
  applyStudioBuilderConfig,
  assertStudioVersion,
  createStudioBuild,
  parseStudioRelease,
  readStudioUpdateTest,
  applyDesktopControlResources,
  studioBuildDefines,
  type StudioBuildInfo,
} from "../scripts/studio-release.fork.mjs";
import { buildDesktopAboutDetails } from "../src/desktop-about-panel.js";
import {
  createDesktopAutoUpdateService,
  type DesktopAutoUpdaterAdapter,
} from "../src/desktop-auto-update.js";
import {
  formatStudioAboutVersion,
  parseStudioBuild,
  type StudioBuild,
} from "../src/studio-release.fork.js";
import { applyStudioUpdateTest } from "../src/studio-desktop.fork.js";

vi.mock("electron", () => ({
  app: { commandLine: { appendSwitch: vi.fn() }, setPath: vi.fn() },
}));

const upstream = {
  version: "0.49.0",
  commit: "030b1b729f28acedc6f86cd65a71cb3678da8124",
};
const release = parseStudioRelease(
  readFileSync(resolve(process.cwd(), "studio-release.fork.json"), "utf8"),
);

function injected(build: StudioBuildInfo): StudioBuild {
  const defines = studioBuildDefines(build);
  const parsed = parseStudioBuild(
    JSON.parse(defines["process.env.BB_STUDIO_BUILD"] ?? "null") as string,
  );
  if (parsed === null) throw new Error("build info did not round-trip");
  return parsed;
}

describe("Studio version line", () => {
  it("starts at 1.0.0 or higher and rejects a 0.x version", () => {
    expect(Number(release.version.split(".")[0])).toBeGreaterThanOrEqual(1);
    expect(() => assertStudioVersion("0.1.0", "version")).toThrow(/1\.0\.0/);
    expect(() => assertStudioVersion("1.0", "version")).toThrow(/x\.y\.z/);
  });

  it("builds the app with the Studio version, not bb's", () => {
    const build = createStudioBuild({ release, upstream, test: null });
    const defines = studioBuildDefines(build);
    expect(defines["process.env.BB_DESKTOP_VERSION"]).toBe(
      JSON.stringify(release.version),
    );
    const config = applyStudioBuilderConfig(
      { extraMetadata: { name: "bb-studio-desktop" } },
      build,
    );
    expect(config.extraMetadata).toEqual({
      name: "bb-studio-desktop",
      version: release.version,
    });
  });

  it("shows the Studio version and the bb base in About", () => {
    const build = injected(
      createStudioBuild({
        release: { ...release, version: "1.0.0" },
        upstream,
        test: null,
      }),
    );
    const version = formatStudioAboutVersion("1.0.0", build);
    expect(version).toBe("1.0.0 (based on bb 0.49.0 @ 030b1b7)");
    const details = buildDesktopAboutDetails(
      {
        applicationName: "BB Studio",
        buildDate: "",
        channel: "latest",
        commit: "",
        electronVersion: "",
        osArch: "",
        osRelease: "",
        osType: "",
        platform: "darwin",
        pluginSdkVersion: "",
        version,
      },
      null,
    );
    expect(details.split("\n")[0]).toBe(
      "Version: 1.0.0 (based on bb 0.49.0 @ 030b1b7)",
    );
  });

  it("shows the plain version when no Studio build info was injected", () => {
    expect(formatStudioAboutVersion("1.0.0", null)).toBe("1.0.0");
    expect(parseStudioBuild(undefined)).toBeNull();
    expect(parseStudioBuild("{")).toBeNull();
  });
});

describe("Studio update feed", () => {
  it("reads updates from bb-studio's GitHub releases with no token", () => {
    const build = injected(createStudioBuild({ release, upstream, test: null }));
    expect(build.updateFeed).toEqual({
      provider: "github",
      owner: "patleeman",
      repo: "bb-studio",
    });
    expect(JSON.stringify(build)).not.toMatch(/token/i);
    expect(build.versionFeedBaseUrl).toBe(
      "https://github.com/patleeman/bb-studio/releases/latest/download/",
    );
    expect(build.test).toBeNull();
    const config = applyStudioBuilderConfig({}, build as StudioBuildInfo);
    expect(config.publish).toEqual([
      {
        provider: "github",
        owner: "patleeman",
        repo: "bb-studio",
        channel: "latest",
      },
    ]);
    expect(config.appId).toBeUndefined();
  });

  it("points a test build at a local feed under its own identity", () => {
    const test = readStudioUpdateTest({
      BB_STUDIO_UPDATE_TEST: JSON.stringify({
        root: "/tmp/bbs-update-e2e",
        feedUrl: "http://127.0.0.1:39123/",
        version: "1.0.1",
      }),
    });
    const build = createStudioBuild({ release, upstream, test });
    expect(build.version).toBe("1.0.1");
    expect(build.updateFeed).toEqual({
      provider: "generic",
      url: "http://127.0.0.1:39123/",
    });
    const config = applyStudioBuilderConfig({}, build);
    expect(config.appId).toBe("nyc.plee.bbstudio.updatetest");
    expect(config.productName).toBe("BB Studio Update Test");
    expect(config.extraMetadata.name).toBe("bb-studio-updatetest");
    const env: NodeJS.ProcessEnv = {};
    let userData = "";
    const switches: string[] = [];
    applyStudioUpdateTest(
      injected(build).test,
      env,
      (path) => {
        userData = path;
      },
      (name, value) => switches.push(`${name}=${value}`),
    );
    expect(env).toEqual({
      BB_DATA_DIR: "/tmp/bbs-update-e2e/data",
      BB_HOST_DAEMON_PORT: "38997",
      BB_SERVER_PORT: "38996",
      BB_SKIP_ONBOARDING: "1",
      BB_STUDIO_IMPORT_FROM: "off",
    });
    expect(userData).toBe("/tmp/bbs-update-e2e/user-data");
    expect(switches).toEqual(["remote-debugging-port=9339"]);
  });

  it("names a labeled test build as its own app", () => {
    const test = readStudioUpdateTest({
      BB_STUDIO_UPDATE_TEST: JSON.stringify({
        root: "/tmp/bbs-hud",
        feedUrl: "http://127.0.0.1:9/",
        label: "HUD Test",
      }),
    });
    const config = applyStudioBuilderConfig({}, createStudioBuild({ release, upstream, test }));
    expect(config.appId).toBe("nyc.plee.bbstudio.hudtest");
    expect(config.productName).toBe("BB Studio HUD Test");
    expect(config.extraMetadata.name).toBe("bb-studio-hudtest");
    expect(() =>
      readStudioUpdateTest({
        BB_STUDIO_UPDATE_TEST: JSON.stringify({ root: "/tmp/x", feedUrl: "github", label: "../x" }),
      }),
    ).toThrow(/label/);
  });

  it("bundles staged desktop control as an extra resource, and nothing when it is not staged", () => {
    const staged = applyDesktopControlResources({ mac: { extraResources: ["x"] } }, "/stage", () => true);
    expect(staged.mac?.extraResources).toEqual([
      "x",
      { from: "/stage", to: "desktop-control", filter: ["cua-driver", "bb-studio-desktop-helper", "NOTICE.md", "driver.json"] },
    ]);
    expect(applyDesktopControlResources({}, "/stage", () => false)).toEqual({});
  });

  it("keeps the real GitHub feed in a test build when asked", () => {
    const test = readStudioUpdateTest({
      BB_STUDIO_UPDATE_TEST: JSON.stringify({
        root: "/tmp/bbs-update-e2e",
        feedUrl: "github",
      }),
    });
    const build = createStudioBuild({ release, upstream, test });
    expect(build.updateFeed).toEqual(release.updates);
    expect(build.test?.root).toBe("/tmp/bbs-update-e2e");
  });

  it("accepts only a loopback test feed", () => {
    expect(readStudioUpdateTest({})).toBeNull();
    expect(() =>
      readStudioUpdateTest({
        BB_STUDIO_UPDATE_TEST: JSON.stringify({
          root: "/tmp/x",
          feedUrl: "https://example.com/",
        }),
      }),
    ).toThrow(/127\.0\.0\.1/);
  });

  it("leaves a release build without the test identity or data dir", () => {
    const env: NodeJS.ProcessEnv = {};
    const setUserData = vi.fn();
    const appendSwitch = vi.fn();
    applyStudioUpdateTest(null, env, setUserData, appendSwitch);
    expect(env).toEqual({});
    expect(setUserData).not.toHaveBeenCalled();
    expect(appendSwitch).not.toHaveBeenCalled();
  });

  it("fails quietly while the releases feed is missing or private", async () => {
    const errorHandlers: Array<
      Parameters<DesktopAutoUpdaterAdapter["onError"]>[0]
    > = [];
    const notFound = new Error(
      'Unable to find latest version on GitHub (https://github.com/patleeman/bb-studio/releases/latest), please ensure a production release exists: HttpError: 404 "method: GET url: https://github.com/patleeman/bb-studio/releases.atom"',
    );
    const adapter: DesktopAutoUpdaterAdapter = {
      checkForUpdates: vi.fn(async (): Promise<UpdateCheckResult | null> => {
        for (const handler of errorHandlers) {
          handler({ error: notFound, message: null });
        }
        throw notFound;
      }),
      downloadUpdate: vi.fn(async () => []),
      onError: (handler) => {
        errorHandlers.push(handler);
      },
      onUpdateAvailable: vi.fn(),
      onUpdateDownloaded: vi.fn(),
      onUpdateNotAvailable: vi.fn(),
      quitAndInstall: vi.fn(async () => undefined),
      setAutoDownload: vi.fn(),
      setAutoInstallOnAppQuit: vi.fn(),
      setFeedURL: vi.fn(),
      setForceDevUpdateConfig: vi.fn(),
      setLogger: vi.fn(),
    };
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    const service = createDesktopAutoUpdateService({
      currentVersion: "1.0.0",
      enabled: true,
      forceDevUpdateConfig: false,
      logger,
      now: () => Date.parse("2026-11-12T00:00:00.000Z"),
      platform: "macos",
      updater: adapter,
    });
    const listener = vi.fn();
    service.subscribe(listener);

    const info = await service.checkForUpdates();

    expect(info).toMatchObject({
      downloadState: "idle",
      latestVersion: null,
      pendingVersion: null,
      updateAvailable: false,
      updateDownloaded: false,
      version: "1.0.0",
    });
    expect(logger.error).toHaveBeenCalled();
    expect(adapter.downloadUpdate).not.toHaveBeenCalled();
    expect(adapter.quitAndInstall).not.toHaveBeenCalled();
  });
});
