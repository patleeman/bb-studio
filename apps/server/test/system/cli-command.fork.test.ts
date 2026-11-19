import {
  chmodSync,
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

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "bb-fork-cli-command-"));
  scratchDirs.push(root);
  const home = join(root, "home");
  const studioLauncher = join(home, ".bb-studio", "bin", "bb");
  const stockLauncher = join(home, ".bb", "bin", "bb");
  const localBin = join(home, ".local", "bin");
  writeLauncher(studioLauncher);
  writeLauncher(stockLauncher);
  mkdirSync(localBin, { recursive: true });
  symlinkSync(stockLauncher, join(localBin, "bb"));
  const service = createCliCommandService({
    env: { PATH: [localBin, "/usr/bin"].join(":") },
    homeDir: home,
    launcherPath: studioLauncher,
    platform: "linux",
    windowsUserPath: {
      read: () => Promise.reject(new Error("unused")),
      write: () => Promise.reject(new Error("unused")),
    },
  });
  return { link: join(localBin, "bb"), service, stockLauncher };
}

describe("BB Studio's bb command beside stock bb", () => {
  posixIt("leaves stock bb's bb link in place and names it", async () => {
    const { link, service, stockLauncher } = fixture();

    await expect(service.getStatus()).resolves.toEqual({
      installedPath: null,
      onPath: false,
      shadowedBy: { path: link, source: "other" },
      supported: true,
    });
    await expect(service.install()).rejects.toMatchObject({
      body: { code: "cli_command_blocked" },
    });
    expect(readlinkSync(link)).toBe(stockLauncher);

    await service.remove();
    expect(readlinkSync(link)).toBe(stockLauncher);
  });
});
