// Bringing servers over from Agent Plugins: a staged fake database with a
// server inside its package (./cmd), an OAuth server and secret env values.
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { CLIENT, FAKE_SECRET, FIXTURE, harness, json, type Harness } from "./harness";

let h: Harness | null = null;
afterEach(async () => { await h?.close(); h = null; });

function stageAgentPlugins(path: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const db = new Database(path);
  db.exec(`CREATE TABLE plugins (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE plugin_skills (pluginId TEXT NOT NULL, skillName TEXT NOT NULL);
    CREATE TABLE mcp_servers (pluginId TEXT NOT NULL, serverId TEXT NOT NULL, type TEXT NOT NULL, configJson TEXT NOT NULL, status TEXT NOT NULL, lastError TEXT, approved INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1);`);
  db.prepare("INSERT INTO plugins VALUES (?, ?)").run("pa-notes", "notes-pack");
  db.prepare("INSERT INTO plugins VALUES (?, ?)").run("pa-mail", "mail-pack");
  db.prepare("INSERT INTO plugin_skills VALUES (?, ?)").run("pa-notes", "notes-howto");
  const insert = db.prepare("INSERT INTO mcp_servers VALUES (?, ?, ?, ?, 'idle', NULL, ?, ?)");
  insert.run("pa-notes", "notes", "stdio", JSON.stringify({ type: "stdio", command: process.execPath, args: [FIXTURE], env: { FAKE_TOKEN: FAKE_SECRET } }), 1, 1);
  insert.run("pa-notes", "packaged", "stdio", JSON.stringify({ type: "stdio", command: "./bin/server", args: ["--data", "${PLUGIN_DATA}"] }), 1, 1);
  insert.run("pa-mail", "mail", "streamable-http", JSON.stringify({ type: "streamable-http", url: "https://mail.example.test/mcp" }), 1, 0);
  insert.run("pa-mail", "keyed", "streamable-http", JSON.stringify({ type: "streamable-http", url: "https://keyed.example.test/mcp", headers: { Authorization: `Bearer ${FAKE_SECRET}` } }), 0, 1);
  db.close();
}

describe("import from Agent Plugins", () => {
  it("lists bb's staged servers with names only, flags package commands, and imports what the user ticks", async () => {
    h = await harness({ plugins: ["agent-plugins"] });
    stageAgentPlugins(join(h.dataDir, "plugins", "studio", "import-staged", "tool-gateway.db"));

    const preview = await h.rpc("toolGateway.importPreview", null, CLIENT);
    expect(preview.source).toBe("bb");
    expect(preview.oldPluginInstalled).toBe(true);
    expect(preview.skills).toEqual(["notes-pack: notes-howto"]);
    expect(JSON.stringify(preview)).not.toContain(FAKE_SECRET);
    const byId = Object.fromEntries(preview.servers.map((server: { id: string }) => [server.id, server]));
    expect(byId.notes).toMatchObject({ kind: "stdio", envNames: ["FAKE_TOKEN"], needsNewCommand: null, wasApproved: true, wasEnabled: true });
    expect(byId.packaged.needsNewCommand).toMatch(/inside the Agent Plugins package/);
    expect(byId.mail).toMatchObject({ kind: "streamable-http", oauth: true, wasEnabled: false });
    expect(byId.keyed).toMatchObject({ headerNames: ["Authorization"], oauth: false, wasApproved: false });
    expect((await h.rpc("toolGateway.snapshot", null)).importable).toBe(3);

    await expect(h.rpc("toolGateway.import", { ids: ["notes"] }, CLIENT)).rejects.toMatchObject({ code: "forbidden" });
    const result = await h.rpc("toolGateway.import", { ids: ["notes", "packaged", "mail", "keyed"] });
    expect(result.imported).toEqual(["notes", "mail", "keyed"]);
    expect(result.skipped).toEqual([{ id: "packaged", reason: expect.stringMatching(/inside the Agent Plugins package/) }]);

    const servers = (await h.rpc("toolGateway.snapshot", null)).servers;
    expect(servers.find((server: { id: string }) => server.id === "notes")).toMatchObject({ approved: true, enabled: true, source: "import" });
    // Its old on/off state comes over; OAuth comes over signed out.
    expect(servers.find((server: { id: string }) => server.id === "mail")).toMatchObject({ approved: true, enabled: false, signIn: "signed-out" });
    expect(JSON.stringify(servers)).not.toContain(FAKE_SECRET);

    // The values moved into the secret store, and the server runs with them.
    const found = json(await h.agent("tool_gateway_search", { query: "environment", server: "notes" }));
    const env = json(await h.agent("tool_gateway_call", { id: found.tools[0].id, args: {} }));
    expect(env.names).toContain("FAKE_TOKEN");

    // Imported again: nothing is duplicated.
    const again = await h.rpc("toolGateway.import", { ids: ["notes"] });
    expect(again).toEqual({ imported: [], skipped: [{ id: "notes", reason: "Already here." }] });

    // Offered afterwards: remove the old plugin, from the app window only.
    await expect(h.rpc("toolGateway.removeOldPlugin", null, CLIENT)).rejects.toMatchObject({ code: "forbidden" });
    await h.rpc("toolGateway.removeOldPlugin", null);
    expect(h.removedPlugins).toEqual(["agent-plugins"]);
  });

  it("reads Agent Plugins' own data in BB Studio when nothing was staged", async () => {
    h = await harness();
    const own = join(h.dataDir, "plugins", "agent-plugins", "data.db");
    stageAgentPlugins(own);
    expect((await h.rpc("toolGateway.importPreview", null)).source).toBe("studio");
    rmSync(own);
    expect((await h.rpc("toolGateway.importPreview", null)).source).toBeNull();
  });
});
