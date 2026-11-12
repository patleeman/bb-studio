import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getInstalledPluginRegistration, type DbConnection } from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import type { Logger } from "@bb/logger";
import { createAiServiceRegistry } from "../../../src/services/ai/ai-service-registry.js";
import {
  createPluginService,
  type PluginService,
} from "../../../src/services/plugins/plugin-service.js";
import type { BundledPluginRegistration } from "../../../src/services/plugins/builtin-registry.js";
import {
  FORK_BUNDLED_PLUGINS,
  withForkBundledPlugins,
} from "../../../src/services/plugins/builtin-registry.fork.js";
import { testLogger } from "../../helpers/test-app.js";
import { createNoopTelemetryService } from "../../../src/services/system/telemetry.js";

const logger = testLogger as unknown as Logger;
const globals = globalThis as Record<string, unknown>;

const PACKAGES: Record<string, string> = {
  "bb-studio": "@bb-studio/studio",
  "bb-studio-visual-chat": "@bb-studio/studio-visual-chat",
};

async function writePlugin(dir: string, name: string, origin: string) {
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({
      name: PACKAGES[name],
      version: "0.1.0",
      type: "module",
      bb: {
        name,
        description: `${name} fixture.`,
        branding: { icon: "Zap" },
        server: "./server.ts",
      },
    }),
  );
  await writeFile(
    join(dir, "server.ts"),
    `export default function plugin(bb: any) {
  const loads = ((globalThis as any).__forkBundledLoads ??= []);
  loads.push(\`\${bb.pluginId}:${origin}\`);
}
`,
  );
}

function loads(): string[] {
  return (globals.__forkBundledLoads as string[] | undefined) ?? [];
}

function createService(
  db: DbConnection,
  dataDir: string,
  bundledPlugins: BundledPluginRegistration[],
): PluginService {
  return createPluginService({
    aiServices: createAiServiceRegistry(),
    telemetry: createNoopTelemetryService(),
    db,
    hub: {
      getDaemonSessionIdForHost: () => null,
      notifyPluginChanged: () => {},
      onWatchedTargets: () => () => {},
      notifyPluginSignal: () => 0,
      notifySystem: () => {},
    },
    logger,
    dataDir,
    appVersion: "0.9.0",
    bundledPlugins,
    loadTimeoutMs: 5000,
  });
}

describe("BB Studio's bundled plugins", () => {
  let db: DbConnection;
  let workDir: string;
  let service: PluginService | undefined;
  let bundledRoot: string;

  beforeEach(async () => {
    delete globals.__forkBundledLoads;
    db = createMigratedConnection();
    workDir = await mkdtemp(join(tmpdir(), "bb-fork-bundled-"));
    bundledRoot = join(workDir, "builtin-plugins");
    for (const plugin of FORK_BUNDLED_PLUGINS) {
      await writePlugin(join(bundledRoot, plugin.name), plugin.name, "bundled");
    }
  });

  afterEach(async () => {
    await service?.stop();
    service = undefined;
    db.$client.close();
    await rm(workDir, { recursive: true, force: true });
  });

  it("adds Studio and Visual Chat to bb's bundled plugins once", () => {
    const resolveRoot = (name: string) => join(bundledRoot, name);
    const once = withForkBundledPlugins([], resolveRoot);
    expect(once.map((plugin) => [plugin.pluginId, plugin.rootDir])).toEqual([
      ["studio", join(bundledRoot, "bb-studio")],
      ["studio-visual-chat", join(bundledRoot, "bb-studio-visual-chat")],
    ]);
    expect(withForkBundledPlugins(once, resolveRoot)).toHaveLength(2);
    expect(
      once.every((plugin) => plugin.autoInstall && plugin.defaultEnabled),
    ).toBe(true);
  });

  it("installs and runs both on a fresh data dir", async () => {
    service = createService(
      db,
      join(workDir, "data"),
      withForkBundledPlugins([], (name) => join(bundledRoot, name)),
    );
    await service.start();

    for (const [id, name] of [
      ["studio", "bb-studio"],
      ["studio-visual-chat", "bb-studio-visual-chat"],
    ] as const) {
      expect(getInstalledPluginRegistration(db, id)).toMatchObject({
        source: `builtin:${name}`,
        provenance: "builtin",
        sourceKind: "builtin",
        enabled: true,
        rootDir: join(bundledRoot, name),
      });
    }
    expect(loads().sort()).toEqual([
      "studio-visual-chat:bundled",
      "studio:bundled",
    ]);
  });

  it("keeps a path install of Studio over the bundled copy", async () => {
    const pathRoot = join(workDir, "checkout", "bb-studio");
    await writePlugin(pathRoot, "bb-studio", "path");
    const dataDir = join(workDir, "data");

    service = createService(
      db,
      dataDir,
      withForkBundledPlugins([], (name) => join(workDir, "missing", name)),
    );
    await service.start();
    await service.install(`path:${pathRoot}`, { kind: "root" });
    await service.stop();
    delete globals.__forkBundledLoads;

    service = createService(
      db,
      dataDir,
      withForkBundledPlugins([], (name) => join(bundledRoot, name)),
    );
    await service.start();

    expect(getInstalledPluginRegistration(db, "studio")).toMatchObject({
      source: `path:${pathRoot}`,
      sourceKind: "path",
      rootDir: pathRoot,
      enabled: true,
    });
    expect(
      getInstalledPluginRegistration(db, "studio-visual-chat"),
    ).toMatchObject({
      sourceKind: "builtin",
    });
    expect(loads().sort()).toEqual([
      "studio-visual-chat:bundled",
      "studio:path",
    ]);
  });
});
