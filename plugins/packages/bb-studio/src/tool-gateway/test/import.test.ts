// Bringing servers over from Agent Plugins: a staged fake database with a
// server inside its package (./cmd), an OAuth server and secret env values.
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { slug } from "../server/import";
import { CLIENT, FAKE_SECRET, FIXTURE, harness, json, type Harness } from "./harness";

let h: Harness | null = null;
afterEach(async () => { await h?.close(); h = null; });

const stagedPath = (h: Harness) => join(h.dataDir, "plugins", "studio", "secrets", "tool-gateway", "agent-plugins-import.db");

type Row = [pluginId: string, serverId: string, type: string, config: Record<string, unknown>, approved: number, enabled: number];

const ROWS: Row[] = [
  ["pa-notes", "notes", "stdio", { type: "stdio", command: process.execPath, args: [FIXTURE], env: { FAKE_TOKEN: FAKE_SECRET } }, 1, 1],
  ["pa-notes", "packaged", "stdio", { type: "stdio", command: "./bin/server", args: ["--data", "${PLUGIN_DATA}"] }, 1, 1],
  ["pa-mail", "mail", "streamable-http", { type: "streamable-http", url: "https://mail.example.test/mcp" }, 1, 0],
  ["pa-mail", "keyed", "streamable-http", { type: "streamable-http", url: "https://keyed.example.test/mcp", headers: { Authorization: `Bearer ${FAKE_SECRET}` } }, 0, 1],
];

function stageAgentPlugins(path: string, rows: Row[] = ROWS): void {
  mkdirSync(join(path, ".."), { recursive: true });
  rmSync(path, { force: true });
  const db = new Database(path);
  db.exec(`CREATE TABLE plugins (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE plugin_skills (pluginId TEXT NOT NULL, skillName TEXT NOT NULL);
    CREATE TABLE mcp_servers (pluginId TEXT NOT NULL, serverId TEXT NOT NULL, type TEXT NOT NULL, configJson TEXT NOT NULL, status TEXT NOT NULL, lastError TEXT, approved INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1);`);
  db.prepare("INSERT INTO plugins VALUES (?, ?)").run("pa-notes", "notes-pack");
  db.prepare("INSERT INTO plugins VALUES (?, ?)").run("pa-mail", "mail-pack");
  db.prepare("INSERT INTO plugin_skills VALUES (?, ?)").run("pa-notes", "notes-howto");
  const insert = db.prepare("INSERT INTO mcp_servers VALUES (?, ?, ?, ?, 'idle', NULL, ?, ?)");
  for (const [pluginId, serverId, type, config, approved, enabled] of rows) insert.run(pluginId, serverId, type, JSON.stringify(config), approved, enabled);
  db.close();
}

const pick = (preview: { servers: { id: string; digest: string }[] }, ...ids: string[]) => ({ servers: preview.servers.filter((server) => ids.includes(server.id)).map(({ id, digest }) => ({ id, digest })) });

describe("import from Agent Plugins", () => {
  it("lists bb's staged servers with names only, flags package commands, imports what the user ticks, then deletes the staged copy", async () => {
    h = await harness({ plugins: ["agent-plugins"] });
    stageAgentPlugins(stagedPath(h));

    const preview = await h.rpc("toolGateway.importPreview", null);
    expect(preview.source).toBe("bb");
    expect(preview.oldPluginInstalled).toBe(true);
    expect(preview.skills).toEqual(["notes-pack: notes-howto"]);
    expect(JSON.stringify(preview)).not.toContain(FAKE_SECRET);
    expect(statSync(stagedPath(h)).mode & 0o777).toBe(0o600);
    const byId = Object.fromEntries(preview.servers.map((server: { id: string }) => [server.id, server]));
    expect(byId.notes).toMatchObject({ kind: "stdio", envNames: ["FAKE_TOKEN"], needsNewCommand: null, wasApproved: true, wasEnabled: true, cwd: null });
    expect(byId.packaged.needsNewCommand).toMatch(/inside the Agent Plugins package/);
    expect(byId.mail).toMatchObject({ kind: "streamable-http", oauth: true, wasEnabled: false });
    expect(byId.keyed).toMatchObject({ headerNames: ["Authorization"], oauth: false, wasApproved: false });
    expect((await h.rpc("toolGateway.snapshot", null)).importable).toBe(3);

    await expect(h.rpc("toolGateway.import", pick(preview, "notes"), CLIENT)).rejects.toMatchObject({ code: "forbidden" });
    const result = await h.rpc("toolGateway.import", pick(preview, "notes", "packaged", "mail", "keyed"));
    expect(result.imported.sort()).toEqual(["keyed", "mail", "notes"]);
    expect(result.skipped).toEqual([{ id: "packaged", reason: expect.stringMatching(/inside the Agent Plugins package/) }]);
    // The plain-text copy is gone once the import has run.
    expect(existsSync(stagedPath(h))).toBe(false);

    const servers = (await h.rpc("toolGateway.snapshot", null)).servers;
    expect(servers.find((server: { id: string }) => server.id === "notes")).toMatchObject({ approved: true, enabled: true, source: "import", command: process.execPath });
    // Its old on/off state comes over; OAuth comes over signed out.
    expect(servers.find((server: { id: string }) => server.id === "mail")).toMatchObject({ approved: true, enabled: false, signIn: "signed-out" });
    expect(JSON.stringify(servers)).not.toContain(FAKE_SECRET);

    // The values moved into the secret store, and the server runs with them.
    const found = json(await h.agent("tool_gateway_search", { query: "environment", server: "notes" }));
    const env = json(await h.agent("tool_gateway_call", { id: found.tools[0].id, args: {} }));
    expect(env.names).toContain("FAKE_TOKEN");

    // Staged again: nothing is duplicated.
    stageAgentPlugins(stagedPath(h));
    const again = await h.rpc("toolGateway.import", pick(await h.rpc("toolGateway.importPreview", null), "notes"));
    expect(again).toEqual({ imported: [], skipped: [{ id: "notes", reason: "Already here." }] });

    // Offered afterwards: remove the old plugin, from the app window only.
    await expect(h.rpc("toolGateway.removeOldPlugin", null, CLIENT)).rejects.toMatchObject({ code: "forbidden" });
    await h.rpc("toolGateway.removeOldPlugin", null);
    expect(h.removedPlugins).toEqual(["agent-plugins"]);
  });

  it("runs every row through Add server's checks and shows the folder it approves", async () => {
    h = await harness();
    stageAgentPlugins(stagedPath(h), [
      ["p", "rel", "stdio", { command: process.execPath, args: [FIXTURE], cwd: "../../tmp" }, 1, 1],
      ["p", "dotargs", "stdio", { command: process.execPath, args: ["./server.js"] }, 1, 1],
      ["p", "creds", "streamable-http", { type: "streamable-http", url: "https://user:pw-in-url-999@example.test/mcp" }, 1, 1],
      ["p", "badheader", "streamable-http", { type: "streamable-http", url: "https://h.example.test/mcp", headers: { Host: "evil" } }, 1, 1],
      ["p", "folder", "stdio", { command: process.execPath, args: [FIXTURE], cwd: h.dataDir }, 1, 1],
      ["p", "_odd", "stdio", { command: process.execPath, args: [FIXTURE] }, 1, 1],
    ]);
    const preview = await h.rpc("toolGateway.importPreview", null);
    const byId = Object.fromEntries(preview.servers.map((server: { id: string }) => [server.id, server]));
    expect(byId.rel.needsNewCommand).toMatch(/working folder/);
    expect(byId.dotargs.needsNewCommand).toMatch(/files inside the Agent Plugins package/);
    expect(byId.creds.needsNewCommand).toMatch(/credentials in a header/);
    expect(byId.badheader.needsNewCommand).toMatch(/Host header/);
    expect(byId.folder).toMatchObject({ cwd: h.dataDir, needsNewCommand: null });
    // An id that starts with _ becomes one the contract accepts.
    expect(byId.odd).toMatchObject({ needsNewCommand: null });
    expect(slug("__x__")).toBe("x");
    const result = await h.rpc("toolGateway.import", pick(preview, "rel", "dotargs", "creds", "badheader", "folder", "odd"));
    expect(result.imported.sort()).toEqual(["folder", "odd"]);
    expect(result.skipped.map((each: { id: string }) => each.id).sort()).toEqual(["badheader", "creds", "dotargs", "rel"]);
    const servers = (await h.rpc("toolGateway.snapshot", null)).servers;
    expect(servers.find((server: { id: string }) => server.id === "folder")).toMatchObject({ cwd: h.dataDir, approved: true });
    expect(JSON.stringify(servers)).not.toContain("pw-in-url");
  });

  it("skips a row that changed after the preview, and deletes the staged copy even when the import fails", async () => {
    h = await harness();
    stageAgentPlugins(stagedPath(h));
    const preview = await h.rpc("toolGateway.importPreview", null);
    stageAgentPlugins(stagedPath(h), ROWS.map((row) => (row[1] === "notes" ? [row[0], row[1], row[2], { ...row[3], args: [FIXTURE, "--other"] }, row[4], row[5]] : row)));
    const result = await h.rpc("toolGateway.import", pick(preview, "notes"));
    expect(result).toEqual({ imported: [], skipped: [{ id: "notes", reason: "It changed since you reviewed it." }] });
    expect(existsSync(stagedPath(h))).toBe(false);

    // A database that can't be read still leaves nothing behind.
    mkdirSync(join(stagedPath(h), ".."), { recursive: true });
    writeFileSync(stagedPath(h), "not a database");
    await h.rpc("toolGateway.import", { servers: [{ id: "notes", digest: "x" }] });
    expect(existsSync(stagedPath(h))).toBe(false);
  });

  it("discards a staged copy without importing, from the app window only", async () => {
    h = await harness();
    stageAgentPlugins(stagedPath(h));
    await expect(h.rpc("toolGateway.discardImport", null, CLIENT)).rejects.toMatchObject({ code: "forbidden" });
    expect(existsSync(stagedPath(h))).toBe(true);
    await h.rpc("toolGateway.discardImport", null);
    expect(existsSync(stagedPath(h))).toBe(false);
    expect((await h.rpc("toolGateway.importPreview", null)).source).toBeNull();
  });

  it("shows a caller without the app window names and kinds only", async () => {
    h = await harness();
    stageAgentPlugins(stagedPath(h));
    const brief = await h.rpc("toolGateway.importPreview", null, CLIENT);
    for (const server of brief.servers) expect(server).toMatchObject({ command: null, args: [], cwd: null, url: null, digest: "" });
    expect(brief.servers.map((server: { id: string }) => server.id)).toContain("notes");
  });

  it("reads Agent Plugins' own data in BB Studio when nothing was staged, and removing the plugin removes it", async () => {
    h = await harness({ plugins: ["agent-plugins"] });
    const own = join(h.dataDir, "plugins", "agent-plugins", "data.db");
    stageAgentPlugins(own);
    expect((await h.rpc("toolGateway.importPreview", null)).source).toBe("studio");
    await h.rpc("toolGateway.removeOldPlugin", null);
    expect(existsSync(own)).toBe(false);
    expect((await h.rpc("toolGateway.importPreview", null)).source).toBeNull();
  });
});
