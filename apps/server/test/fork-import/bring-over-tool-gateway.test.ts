import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { afterEach, describe, expect, it } from "vitest";
import { addPlugin } from "../../src/services/fork-import/bring-over/plugins.js";
import { registerBringOverRoutes } from "../../src/services/fork-import/bring-over/routes.js";
import {
  AGENT_PLUGINS_ID,
  TOOL_GATEWAY_STAGED,
} from "../../src/services/fork-import/bring-over/tool-gateway.js";
import {
  adoptUiTokenHash,
  resetUiTokenForTests,
} from "../../src/services/fork-import/bring-over/ui-token.js";
import type { AppDeps } from "../../src/types.js";

const TOKEN = "t".repeat(43);
const dirs: string[] = [];

afterEach(async () => {
  resetUiTokenForTests();
  delete process.env.BB_STUDIO_IMPORT_FROM;
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});

async function setup(withAgentPlugins: boolean) {
  const root = await mkdtemp(join(tmpdir(), "bring-over-tool-gateway-"));
  dirs.push(root);
  const source = join(root, "bb");
  const target = join(root, "studio");
  await mkdir(source, { recursive: true });
  await mkdir(target, { recursive: true });
  new Database(join(source, "bb.db")).close();
  if (withAgentPlugins) {
    await mkdir(join(source, "plugins", AGENT_PLUGINS_ID, "secrets"), {
      recursive: true,
    });
    await writeFile(
      join(source, "plugins", AGENT_PLUGINS_ID, "secrets", "oauth"),
      "not copied",
    );
    const db = new Database(
      join(source, "plugins", AGENT_PLUGINS_ID, "data.db"),
    );
    db.exec(
      "CREATE TABLE mcp_servers (serverId TEXT); INSERT INTO mcp_servers VALUES ('notes');",
    );
    db.close();
  }
  process.env.BB_STUDIO_IMPORT_FROM = source;
  adoptUiTokenHash({
    BB_STUDIO_UI_TOKEN_SHA256: createHash("sha256").update(TOKEN).digest("hex"),
  });
  const hono = new Hono();
  hono.onError((error) =>
    error instanceof HTTPException
      ? error.getResponse()
      : new Response(String(error), { status: 500 }),
  );
  const targetDb = new Database(":memory:");
  const deps = {
    db: { $client: targetDb },
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
    config: { appVersion: "1.0.0" },
  } as unknown as AppDeps;
  registerBringOverRoutes(hono, deps, () => target, null);
  return { hono, source, target, targetDb };
}

const post = (headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: "{}",
});

describe("bring over Agent Plugins as a Tool Gateway import", () => {
  it("stages a private copy of bb's Agent Plugins database for Studio, from the app window only", async () => {
    const { hono, target } = await setup(true);
    const staged = join(target, ...TOOL_GATEWAY_STAGED);
    const refused: Record<string, string>[] = [
      {},
      { "x-bb-studio-ui-token": "u".repeat(43) },
      { "x-bb-studio-ui-token": TOKEN, "x-bb-cli": "1" },
      { "x-bb-studio-ui-token": TOKEN, "x-bb-caller-thread": "thr_test" },
    ];
    for (const headers of refused) {
      expect(
        (
          await hono.request(
            "/fork/bring-over/tool-gateway/stage",
            post(headers),
          )
        ).status,
      ).toBe(403);
    }
    expect(existsSync(staged)).toBe(false);
    const response = await hono.request(
      "/fork/bring-over/tool-gateway/stage",
      post({ "x-bb-studio-ui-token": TOKEN }),
    );
    expect(response.status).toBe(200);
    expect(statSync(staged).mode & 0o777).toBe(0o600);
    expect(statSync(join(staged, "..")).mode & 0o777).toBe(0o700);
    const db = new Database(staged, { readonly: true });
    expect(db.prepare("SELECT serverId FROM mcp_servers").all()).toEqual([
      { serverId: "notes" },
    ]);
    db.close();
    // Only the database: bb's secrets folder is not copied.
    expect(
      existsSync(join(target, "plugins", "studio", "import-staged", "secrets")),
    ).toBe(false);
    expect(existsSync(join(target, "plugins", AGENT_PLUGINS_ID))).toBe(false);
  });

  it("says so when bb has no Agent Plugins data", async () => {
    const { hono } = await setup(false);
    const response = await hono.request(
      "/fork/bring-over/tool-gateway/stage",
      post({ "x-bb-studio-ui-token": TOKEN }),
    );
    expect(response.status).toBe(422);
  });

  it("never adds Agent Plugins itself to BB Studio", async () => {
    const { source, target, targetDb } = await setup(true);
    await expect(
      addPlugin({
        id: AGENT_PLUGINS_ID,
        source: new Database(":memory:"),
        target: targetDb,
        sourceDataDir: source,
        dataDir: target,
        installer: {
          install: async () => ({ id: AGENT_PLUGINS_ID }) as never,
          installPath: async () => ({ id: AGENT_PLUGINS_ID }) as never,
          reload: async () => undefined,
          remove: async () => true,
        },
        appVersion: "1.0.0",
      }),
    ).rejects.toThrow(/import its servers into Tool Gateway/);
  });
});
