import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPluginSettingsValues, type DbConnection } from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import type { Logger } from "@bb/logger";
import { registerPluginRoutes } from "../../../src/routes/plugins.js";
import { createAiServiceRegistry } from "../../../src/services/ai/ai-service-registry.js";
import { createPluginInstallJobs } from "../../../src/services/plugins/plugin-install-jobs.js";
import {
  createPluginService,
  type PluginService,
} from "../../../src/services/plugins/plugin-service.js";
import { createPluginUpdateJobs } from "../../../src/services/plugins/plugin-update-jobs.js";
import { createNoopTelemetryService } from "../../../src/services/system/telemetry.js";
import { redactSecrets } from "../../../src/services/plugins/redact-secrets.fork.js";
import { testLogger } from "../../helpers/test-app.js";

const RELAY_TOKEN = "bbpt_0123456789abcdefSECRETrelayTOKEN42";
const RELAY_URL = `http://127.0.0.1:38886/api/v1/plugins/mobile/http/push?token=${RELAY_TOKEN}`;
const SHOWN_URL =
  "http://127.0.0.1:38886/api/v1/plugins/mobile/http/push?token=[redacted …EN42]";

describe("plugin settings never show a secret in a string setting (fork)", () => {
  let db: DbConnection;
  let workDir: string;
  let service: PluginService;
  let app: Hono;

  beforeEach(async () => {
    db = createMigratedConnection();
    workDir = await mkdtemp(join(tmpdir(), "bb-plugin-redact-test-"));
    service = createPluginService({
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
      logger: testLogger as unknown as Logger,
      dataDir: join(workDir, "data"),
      appVersion: "0.9.0",
      loadTimeoutMs: 2000,
    });
    const rootDir = join(workDir, "bb-plugin-relay");
    await mkdir(rootDir, { recursive: true });
    await writeFile(
      join(rootDir, "package.json"),
      JSON.stringify({
        name: "bb-plugin-relay",
        version: "0.1.0",
        bb: {
          name: "Relay fixture",
          description: "A string setting that holds a tokened URL.",
          branding: { icon: "Zap" },
          server: "./server.ts",
        },
      }),
    );
    await writeFile(
      join(rootDir, "server.ts"),
      `export default async function plugin(bb: any) {
        const settings = bb.settings.define({
          relayUrl: { type: "string", label: "Relay URL", default: "https://hooks.slack.com/services/T0000000/B0000000/DEFAULTSECRETdefault0001" },
          note: { type: "string", label: "Note" },
        });
        (globalThis as any).__relaySettings = settings;
        bb.log.warn('push delivery failed: "ExponentPushToken[deviceSecret0123456789XyZ]" is not a registered push notification recipient');
      }`,
    );
    expect((await service.installPath(rootDir)).status).toBe("running");
    app = new Hono();
    registerPluginRoutes(
      app,
      { config: { serverPort: 3334 }, db },
      service,
      createPluginInstallJobs({ notifyChanged: () => {} }),
      createPluginUpdateJobs({ notifyChanged: () => {} }),
    );
  });

  afterEach(async () => {
    await service.stop();
    await rm(workDir, { recursive: true, force: true });
  });

  const pluginSettings = () =>
    (globalThis as Record<string, unknown>).__relaySettings as {
      get(): Promise<Record<string, unknown>>;
    };

  async function put(values: Record<string, unknown>) {
    return app.request("/plugins/relay/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ values }),
    });
  }

  it("redacts the token in the GET and PUT views; the plugin reads the real value", async () => {
    const saved = await put({ relayUrl: RELAY_URL });
    expect(saved.status).toBe(200);
    const savedText = await saved.text();
    expect(savedText).not.toContain(RELAY_TOKEN);
    expect(JSON.parse(savedText).values.relayUrl).toBe(SHOWN_URL);

    const got = await app.request("/plugins/relay/settings");
    const gotText = await got.text();
    expect(gotText).not.toContain(RELAY_TOKEN);
    expect(JSON.parse(gotText).values.relayUrl).toBe(SHOWN_URL);

    await expect(pluginSettings().get()).resolves.toMatchObject({
      relayUrl: RELAY_URL,
    });
  });

  it("keeps the stored secret when the redacted value comes back unchanged", async () => {
    await put({ relayUrl: RELAY_URL });
    const again = await put({ relayUrl: SHOWN_URL, note: "hi" });
    expect(again.status).toBe(200);
    expect(JSON.parse(getPluginSettingsValues(db, "relay").relayUrl!)).toBe(
      RELAY_URL,
    );
    await expect(pluginSettings().get()).resolves.toMatchObject({
      relayUrl: RELAY_URL,
      note: "hi",
    });
  });

  it("refuses a changed value that still holds a redaction label", async () => {
    await put({ relayUrl: RELAY_URL });
    const edited = await put({
      relayUrl: SHOWN_URL.replace("38886", "38887"),
    });
    expect(edited.status).toBe(400);
    expect(((await edited.json()) as { error: string }).error).toBe(
      "relayUrl holds a redacted secret; enter the whole value to replace it",
    );
    await expect(pluginSettings().get()).resolves.toMatchObject({
      relayUrl: RELAY_URL,
    });

    const replaced = await put({
      relayUrl: "http://127.0.0.1:38887/push?token=newTokenValue0123456789",
    });
    expect(replaced.status).toBe(200);
    await expect(pluginSettings().get()).resolves.toMatchObject({
      relayUrl: "http://127.0.0.1:38887/push?token=newTokenValue0123456789",
    });
  });

  it("the push-notifications plugin's redactor is a copy of the server's", async () => {
    const root = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../../..",
    );
    const [server, plugin] = await Promise.all([
      readFile(
        join(root, "apps/server/src/services/plugins/redact-secrets.fork.ts"),
        "utf8",
      ),
      readFile(join(root, "plugins/push-notifications/redact.fork.ts"), "utf8"),
    ]);
    expect(plugin).toBe(server);
  });
  it("redacts the schema's default and the plugin's log lines", async () => {
    const view = await app.request("/plugins/relay/settings");
    const text = await view.text();
    expect(text).not.toContain("DEFAULTSECRET");
    expect(JSON.parse(text).schema.relayUrl.default).toBe(
      "https://hooks.slack.com/services/[redacted …0001]",
    );
    await vi.waitFor(async () => {
      const logs = (await (
        await app.request("/plugins/relay/logs?tail=50")
      ).json()) as {
        lines: string[];
      };
      expect(logs.lines.join("\n")).toContain(
        "ExponentPushToken[[redacted …9XyZ]]",
      );
    });
    const logs = await (
      await app.request("/plugins/relay/logs?tail=50")
    ).text();
    expect(logs).not.toContain("deviceSecret");
  });
});

const REDACTOR_SHA256 =
  "19ba7f6307a0ad38a09baff0155e049dde31ae81e44a7571c100e3cd414b1f02";
const FIXTURES_SHA256 =
  "49c1f2786ca2cac35ffa06aa38d578956e128ee8383ec4d7a49ffe5337517a27";

describe("redactSecrets matches the Studio plugins' copies (fork)", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const sha = (text: string) => createHash("sha256").update(text).digest("hex");

  it("gives every shared fixture its output, and changes nothing on a second pass", async () => {
    const text = await readFile(
      join(here, "redact-fixtures.fork.json"),
      "utf8",
    );
    const fixtures = JSON.parse(text) as { input: string; output: string }[];
    expect(fixtures.length).toBeGreaterThan(10);
    for (const { input, output } of fixtures) {
      expect(redactSecrets(input)).toBe(output);
      expect(redactSecrets(output)).toBe(output);
    }
  });

  it("pins the redactor and the fixtures to the hashes bb-studio-mobile's redact.test.ts pins", async () => {
    const root = resolve(here, "../../../../..");
    expect(
      sha(
        await readFile(
          join(root, "apps/server/src/services/plugins/redact-secrets.fork.ts"),
          "utf8",
        ),
      ),
    ).toBe(REDACTOR_SHA256);
    expect(
      sha(await readFile(join(here, "redact-fixtures.fork.json"), "utf8")),
    ).toBe(FIXTURES_SHA256);
  });
});
