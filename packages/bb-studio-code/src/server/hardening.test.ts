// The adviser review's fixes (security and correctness), written before them.
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CODE_SERVER_VERSION,
  CodeServers,
  DEFAULT_SETTINGS,
  RELEASE_SHA256,
  codeServerArgs,
  listeningPort,
  serverConfig,
  verifySha256,
  WATCHDOG,
} from "./runtime";
import { LAYOUT_SETTINGS, LAYOUT_VERSION } from "./settings";
import { sensitiveFolder } from "./folders";
import { MIGRATIONS, WorkspaceStore } from "./store";

let dir = "";
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), "studio-code-hardening-")); });
afterAll(() => rm(dir, { recursive: true, force: true }));

const args = (trusted: boolean) => codeServerArgs({ config: "/c.yaml", userData: "/u", extensions: "/e", cookieSuffix: "cws_1", trusted, file: "/w.code-workspace" });

describe("1. each workspace needs its own secret", () => {
  it("runs with password auth on an OS-picked port, never --auth none", () => {
    const list = args(true);
    expect(list).not.toContain("none");
    expect(list.join(" ")).not.toMatch(/--auth\s+none/);
    expect(list).toEqual(expect.arrayContaining(["--bind-addr", "127.0.0.1:0", "--cookie-suffix", "cws_1", "--config", "/c.yaml"]));
  });

  it("keeps the password in a config file, not on the command line", () => {
    expect(serverConfig("p4ss")).toBe("auth: password\npassword: p4ss\n");
    expect(args(true).join(" ")).not.toContain("p4ss");
  });
});

describe("2. the download is checked before it's unpacked", () => {
  it("pins a SHA-256 for every build it can download", () => {
    for (const asset of ["macos-arm64", "macos-amd64", "linux-arm64", "linux-amd64"])
      expect(RELEASE_SHA256[`code-server-${CODE_SERVER_VERSION}-${asset}`]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("accepts the right bytes and refuses others", async () => {
    const file = join(dir, "archive.tar.gz");
    await writeFile(file, "bytes");
    await expect(verifySha256(file, createHash("sha256").update("bytes").digest("hex"))).resolves.toBeUndefined();
    await expect(verifySha256(file, "0".repeat(64))).rejects.toThrow(/checksum/i);
  });
});

describe("3. workspace trust stays on unless the user chose the folders", () => {
  it("doesn't turn trust off in a new workspace's settings", () => {
    expect(DEFAULT_SETTINGS).not.toHaveProperty("security.workspace.trust.enabled");
  });

  it("turns it back on in workspaces made before, once", () => {
    expect(LAYOUT_VERSION).toBeGreaterThanOrEqual(2);
    expect(LAYOUT_SETTINGS["security.workspace.trust.enabled"]).toBe(true);
  });

  it("skips trust only for a trusted workspace's own server", () => {
    expect(args(true)).toContain("--disable-workspace-trust");
    expect(args(false)).not.toContain("--disable-workspace-trust");
  });

  it("records whether a workspace's folders were picked by the user", async () => {
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(":memory:");
    db.exec("CREATE TABLE _m (i INTEGER)");
    for (const statement of MIGRATIONS) db.exec(statement);
    const store = new WorkspaceStore(db);
    expect(store.create({ title: "Mine", projectId: null, folders: [] }).trusted).toBe(true);
    const agents = store.create({ title: "Agent's", projectId: null, folders: [], trusted: false });
    expect(agents.trusted).toBe(false);
    expect(store.update(agents.id, { trusted: true }).trusted).toBe(true);
  });
});

describe("4. Stop ends the whole server, not only its first process", () => {
  it("runs code-server in its own process group and signals the group", () => {
    expect(WATCHDOG).toContain("detached: true");
    expect(WATCHDOG).toContain("process.kill(-child.pid");
  });
});

describe("5. Stop during download or start cancels it", () => {
  it("never starts a server for a workspace stopped while installing", async () => {
    let finishInstall: (bin: string) => void = () => undefined;
    let spawned = 0;
    const servers = new CodeServers({
      root: dir,
      log: { info() {}, warn() {} },
      onChange() {},
      install: () => new Promise<string>((resolve) => { finishInstall = resolve; }),
      spawn: () => { spawned += 1; throw new Error("should not spawn"); },
    });
    const opening = servers.open({ id: "cws_cancel", title: "T", projectId: null, threadId: null, trusted: true, folders: [dir], archived: false, createdAt: 0, updatedAt: 0 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    servers.stop("cws_cancel");
    finishInstall("/bin/false");
    const status = await opening;
    expect(spawned).toBe(0);
    expect(status.state).toBe("stopped");
    expect(servers.status("cws_cancel").state).toBe("stopped");
  });
});

describe("6. the port comes from code-server, not a guess", () => {
  it("reads the port code-server bound", () => {
    expect(listeningPort("[2026-10-06T16:03:35.303Z] info  HTTP server listening on http://127.0.0.1:55709/\n")).toBe(55709);
    expect(listeningPort("info  Session server listening on /tmp/x.sock")).toBeNull();
  });
});

describe("7. folders can't expose the user's secrets", () => {
  const home = "/Users/me";
  it("refuses the root, the home folder, and secret folders or their parents", () => {
    for (const path of ["/", "/Users", home, `${home}/.ssh`, `${home}/.ssh/keys`, `${home}/.aws`, `${home}/.gnupg`, `${home}/Library/Keychains`])
      expect(sensitiveFolder(path, home), path).not.toBeNull();
  });
  it("allows ordinary project folders and BB worktrees", () => {
    for (const path of [`${home}/code/app`, `${home}/.bb/plugins/environment-git-worktree/host-data/worktrees/thr_x-1/app`, "/tmp/orbit"])
      expect(sensitiveFolder(path, home), path).toBeNull();
  });
});
