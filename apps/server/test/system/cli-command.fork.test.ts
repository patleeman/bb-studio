import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CLI_LAUNCHER_MARKER } from "@bb/config/cli-command";
import { createCliCommandService } from "../../src/services/system/cli-command.js";
import { migrateLegacyStudioBbLink } from "../../src/services/system/cli-command.fork.js";

const posixIt = process.platform === "win32" ? it.skip : it;
const scratchDirs: string[] = [];

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function writeLauncher(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `#!/bin/sh\n# ${CLI_LAUNCHER_MARKER}\n`);
  chmodSync(path, 0o755);
}

function linkExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "bb-fork-cli-command-"));
  scratchDirs.push(root);
  const home = join(root, "home");
  const studioLauncher = join(home, ".bb-studio", "bin", "bb");
  const stockLauncher = join(home, ".bb", "bin", "bb");
  const localBin = join(home, ".local", "bin");
  const otherBin = join(root, "other-bin");
  writeLauncher(studioLauncher);
  writeLauncher(stockLauncher);
  mkdirSync(localBin, { recursive: true });
  mkdirSync(otherBin, { recursive: true });
  const env = { PATH: [localBin, otherBin, "/usr/bin"].join(":") };
  const service = createCliCommandService({
    env,
    homeDir: home,
    launcherPath: studioLauncher,
    platform: "linux",
    windowsUserPath: {
      read: () => Promise.reject(new Error("unused")),
      write: () => Promise.reject(new Error("unused")),
    },
  });
  const migrate = (log: string[] = []) =>
    migrateLegacyStudioBbLink({
      env,
      homeDir: home,
      launcherPath: studioLauncher,
      log: (message) => log.push(message),
      platform: "linux",
    });
  return { localBin, migrate, otherBin, service, stockLauncher, studioLauncher };
}

describe("BB Studio's bbs command beside stock bb", () => {
  posixIt("installs bbs and bb-studio and leaves stock bb's bb link alone", async () => {
    const { localBin, service, stockLauncher, studioLauncher } = fixture();
    symlinkSync(stockLauncher, join(localBin, "bb"));

    await expect(service.install()).resolves.toEqual({
      installedPath: join(localBin, "bbs"),
      onPath: true,
      shadowedBy: null,
      supported: true,
    });
    expect(readlinkSync(join(localBin, "bbs"))).toBe(studioLauncher);
    expect(readlinkSync(join(localBin, "bb-studio"))).toBe(studioLauncher);
    expect(readlinkSync(join(localBin, "bb"))).toBe(stockLauncher);

    await service.remove();
    expect(linkExists(join(localBin, "bbs"))).toBe(false);
    expect(linkExists(join(localBin, "bb-studio"))).toBe(false);
    expect(readlinkSync(join(localBin, "bb"))).toBe(stockLauncher);
  });

  posixIt("never takes a bb-studio name that belongs to something else", async () => {
    const { localBin, service, stockLauncher } = fixture();
    symlinkSync(stockLauncher, join(localBin, "bb-studio"));

    await service.install();
    expect(readlinkSync(join(localBin, "bb-studio"))).toBe(stockLauncher);
    await service.remove();
    expect(readlinkSync(join(localBin, "bb-studio"))).toBe(stockLauncher);
  });
});

describe("Studio's old bb link (before bbs)", () => {
  posixIt("adds bbs and removes the old link when stock bb is also on PATH", async () => {
    const { localBin, migrate, otherBin, stockLauncher, studioLauncher } = fixture();
    symlinkSync(studioLauncher, join(localBin, "bb"));
    symlinkSync(stockLauncher, join(otherBin, "bb"));
    const log: string[] = [];

    await expect(migrate(log)).resolves.toEqual([
      { directory: localBin, otherBb: join(otherBin, "bb"), removed: true },
    ]);
    expect(linkExists(join(localBin, "bb"))).toBe(false);
    expect(readlinkSync(join(localBin, "bbs"))).toBe(studioLauncher);
    expect(readlinkSync(join(localBin, "bb-studio"))).toBe(studioLauncher);
    expect(readlinkSync(join(otherBin, "bb"))).toBe(stockLauncher);
    expect(log).toHaveLength(1);
    expect(log[0]).toContain("Removed its old bb link");
  });

  posixIt("keeps the old link when no other bb is on PATH", async () => {
    const { localBin, migrate, studioLauncher } = fixture();
    symlinkSync(studioLauncher, join(localBin, "bb"));
    const log: string[] = [];

    await expect(migrate(log)).resolves.toEqual([
      { directory: localBin, otherBb: null, removed: false },
    ]);
    expect(readlinkSync(join(localBin, "bb"))).toBe(studioLauncher);
    expect(readlinkSync(join(localBin, "bbs"))).toBe(studioLauncher);
    expect(log[0]).toContain("Kept its old bb link");

    await migrate();
    expect(readlinkSync(join(localBin, "bb"))).toBe(studioLauncher);
  });

  posixIt("never touches a bb link that points at stock bb", async () => {
    const { localBin, migrate, stockLauncher } = fixture();
    symlinkSync(stockLauncher, join(localBin, "bb"));

    await expect(migrate()).resolves.toEqual([]);
    expect(readlinkSync(join(localBin, "bb"))).toBe(stockLauncher);
    expect(existsSync(join(localBin, "bbs"))).toBe(false);
  });
});
