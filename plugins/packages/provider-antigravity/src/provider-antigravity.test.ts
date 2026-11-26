import { describe, expect, it, vi } from "vitest";
import { parseKeyringSecret } from "./auth.js";
import { createAntigravityBridgeLineHandler } from "./host.js";
import { parseLatestCliVersionFromChangelog } from "./maintenance.js";
import { normalizeAntigravityUsage } from "./usage.js";

describe("parseKeyringSecret", () => {
  it("parses go-keyring-base64 payloads", () => {
    const payload = {
      token: {
        access_token: "ya29.test-token",
        expiry: "2099-01-01T00:00:00Z",
      },
      auth_method: "consumer",
      id_token_email: "user@example.com",
    };
    const encoded = `go-keyring-base64:${Buffer.from(JSON.stringify(payload), "utf8").toString("base64")}`;
    const parsed = parseKeyringSecret(encoded);
    expect(parsed).toEqual({
      accessToken: "ya29.test-token",
      email: "user@example.com",
      authMethod: "consumer",
      expired: false,
    });
  });

  it("marks past expiry as expired", () => {
    const payload = {
      token: {
        access_token: "ya29.expired",
        expiry: "2020-01-01T00:00:00Z",
      },
    };
    const parsed = parseKeyringSecret(JSON.stringify(payload));
    expect(parsed?.expired).toBe(true);
  });

  it("returns null for malformed input", () => {
    expect(parseKeyringSecret("")).toBeNull();
    expect(parseKeyringSecret("not-json")).toBeNull();
  });
});

describe("normalizeAntigravityUsage", () => {
  it("normalizes summary buckets and adds Gemini fallback from available models", () => {
    const usage = normalizeAntigravityUsage({
      loadCodeAssist: {
        paidTier: { id: "g1-pro-tier", name: "Google AI Pro" },
        currentTier: { id: "free-tier", name: "Antigravity" },
      },
      quotaSummary: {
        groups: [
          {
            displayName: "Claude and GPT models",
            buckets: [
              {
                bucketId: "3p-weekly",
                window: "weekly",
                remainingFraction: 0.75,
              },
              {
                bucketId: "3p-5h",
                window: "5h",
                remainingFraction: 0.9,
              },
            ],
          },
        ],
      },
      availableModels: {
        models: {
          "gemini-3-flash": {
            quotaInfo: {
              remainingFraction: 0.2,
              resetTime: "2026-12-01T01:18:35Z",
            },
          },
          "claude-opus-5-5-high": {
            quotaInfo: {
              remainingFraction: 0.9,
              resetTime: "2026-11-26T07:18:45Z",
            },
          },
        },
      },
      accountEmail: "user@example.com",
    });

    expect(usage.status).toBe("ok");
    if (usage.status !== "ok") return;
    expect(usage.planLabel).toBe("Google AI Pro");
    expect(usage.accountEmail).toBe("user@example.com");
    expect(usage.windows).toEqual([
      {
        kind: "weekly",
        label: "Claude and GPT models (Weekly)",
        usedPercent: 25,
        resetsAt: null,
      },
      {
        kind: "five-hour",
        label: "Claude and GPT models (5-hour)",
        usedPercent: 10,
        resetsAt: "2026-11-26T07:18:45.000Z",
      },
      {
        kind: "custom",
        label: "Gemini models",
        usedPercent: 80,
        resetsAt: "2026-12-01T01:18:35.000Z",
      },
    ]);
  });
});

describe("parseLatestCliVersionFromChangelog", () => {
  it("extracts the newest version under Antigravity CLI", () => {
    const md = [
      "## Antigravity App",
      "",
      "### [v2.1.0](/releases?tab=app&version=2.1.0)",
      "",
      "## Antigravity CLI",
      "",
      '### [v1.5.18](/releases?tab=cli&version=1.5.18 "View release 1.5.18")',
      "",
      "### [v1.5.17](/releases?tab=cli&version=1.5.17)",
    ].join("\n");
    expect(parseLatestCliVersionFromChangelog(md)).toBe("1.5.18");
  });
});

describe("createAntigravityBridgeLineHandler", () => {
  it("intercepts installation status and forwards other methods", async () => {
    const fallback = vi.fn();
    const written: string[] = [];
    const getStatus = vi.fn(async () => ({
      executableName: "agy",
      executablePath: "/usr/local/bin/agy",
      installed: true,
      installSource: "external" as const,
      currentVersion: "1.5.17",
      latestVersion: "1.5.18",
      minimumSupportedVersion: null,
      npmPackageName: null,
      npmGlobalPackageVersion: null,
      installAction: {
        kind: "update" as const,
        label: "Update" as const,
        command: "agy update",
      },
      needsUpdate: true,
      versionUnsupported: false,
    }));

    const handler = createAntigravityBridgeLineHandler({
      fallback,
      write: (line) => written.push(line),
      getStatus,
    });

    handler(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "provider/installation/status",
        params: { checkUpdates: true },
      }),
    );
    await vi.waitFor(() => expect(written).toHaveLength(1));
    expect(JSON.parse(written[0]!)).toMatchObject({
      jsonrpc: "2.0",
      id: 7,
      result: { currentVersion: "1.5.17", needsUpdate: true },
    });
    expect(fallback).not.toHaveBeenCalled();

    const otherLine = JSON.stringify({
      jsonrpc: "2.0",
      id: 8,
      method: "provider/health",
      params: {},
    });
    handler(otherLine);
    expect(fallback).toHaveBeenCalledWith(otherLine);
  });
});
