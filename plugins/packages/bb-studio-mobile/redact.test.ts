import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import plugin from "./server.js";
import { redactSecrets } from "./redact.js";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const here = dirname(fileURLToPath(import.meta.url));
const DEVICE = "ExponentPushToken[deviceSecret0123456789XyZ]";

describe("the relay never prints a device token", () => {
  it("redacts Expo's error text in the stored delivery, the log and bb mobile status", async () => {
    const host = createFakePluginHost({ pluginId: "mobile", sdk: { threads: { interactions: { list: async () => [] } } } });
    const warn = vi.spyOn(host.bb.log, "warn");
    await plugin(host.bb);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      data: [{ status: "error", message: `"${DEVICE}" is not a registered push notification recipient`, details: { error: "DeviceNotRegistered" } }],
    })));
    try {
      const response = await host.harness.behavior.fetchHttp("POST", "/push", {
        body: JSON.stringify([{ to: DEVICE, body: "Done", data: { threadId: "thr_a" } }]),
        headers: { "content-type": "application/json" },
      });
      expect(response.status).toBe(200);
      const stored = JSON.stringify(await host.bb.storage.kv.get("last-delivery"));
      expect(stored).not.toContain("deviceSecret");
      expect(stored).toContain("ExponentPushToken[[redacted …9XyZ]]");
      expect(JSON.stringify(warn.mock.calls)).not.toContain("deviceSecret");

      await host.bb.storage.kv.set("last-delivery", { at: "2026-11-21T00:00:00.000Z", apns: 0, expo: 1, errors: [`"${DEVICE}" is gone`] });
      for (const argv of [["status"], ["status", "--json"]]) {
        const result = await host.harness.behavior.runCli(argv);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).not.toContain("deviceSecret");
        expect(result.stdout).toContain("[redacted …9XyZ]");
        expect(result.stdout).toMatch(/\/api\/v1\/plugins\/mobile\/http\/push\?token=<bbs? plugin token mobile>/);
      }
    } finally { await host.harness.lifecycle.dispose(); }
  });

  it("never points the relay at stock bb's server", () => {
    const skill = readFileSync(join(here, "skills/mobile-push/SKILL.md"), "utf8");
    expect(skill).not.toMatch(/3888[67]/u);
    expect(skill).toContain("${BB_SERVER_URL:-http://127.0.0.1:38986}/api/v1/plugins/mobile/http/push?token=$(bbs plugin token mobile)");
  });
});

/** The same hashes are pinned in the desktop app's plugin-settings-redact.fork.test.ts. */
export const REDACTOR_SHA256 = "19ba7f6307a0ad38a09baff0155e049dde31ae81e44a7571c100e3cd414b1f02";
export const FIXTURES_SHA256 = "49c1f2786ca2cac35ffa06aa38d578956e128ee8383ec4d7a49ffe5337517a27";

/** The copy without its header comment: the desktop app's redact-secrets.fork.ts, byte for byte. */
export function redactorBody(source: string): string {
  return source.slice(source.indexOf("export const REDACTED_LABEL"));
}

describe("redactSecrets, the desktop app's redactor", () => {
  const sha = (text: string) => createHash("sha256").update(text).digest("hex");
  const fixturesText = readFileSync(join(here, "redact-fixtures.json"), "utf8");

  it("gives every shared fixture its output, and changes nothing on a second pass", () => {
    const fixtures = JSON.parse(fixturesText) as { input: string; output: string }[];
    expect(fixtures.length).toBeGreaterThan(10);
    for (const { input, output } of fixtures) {
      expect(redactSecrets(input)).toBe(output);
      expect(redactSecrets(output)).toBe(output);
    }
  });

  it("is pinned to the desktop app's copy and the shared fixtures", () => {
    expect(sha(redactorBody(readFileSync(join(here, "redact.ts"), "utf8")))).toBe(REDACTOR_SHA256);
    expect(sha(fixturesText)).toBe(FIXTURES_SHA256);
  });
});
