// Finds the Studio Applets shell: whether it's installed, which version, and
// whether it's running (its socket answers). The plugin works without it.
import { readFile, stat } from "node:fs/promises";
import { connect } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";

export const APP_NAME = "Studio Applets.app";

export type ShellState = "not-installed" | "stopped" | "running";

export type ShellStatus = {
  state: ShellState;
  appPath: string | null;
  version: string | null;
  socketPath: string;
};

export function appCandidates(): string[] {
  return [join(homedir(), "Applications", APP_NAME), join("/Applications", APP_NAME)];
}

async function findApp(): Promise<string | null> {
  for (const path of appCandidates()) if (await stat(path).then((s) => s.isDirectory(), () => false)) return path;
  return null;
}

async function appVersion(appPath: string): Promise<string | null> {
  const plist = await readFile(join(appPath, "Contents", "Info.plist"), "utf8").catch(() => "");
  return /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)?.[1] ?? null;
}

function socketAnswers(path: string, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(path);
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

export async function shellStatus(root: string): Promise<ShellStatus> {
  const socketPath = join(root, "shell.sock");
  const appPath = await findApp();
  const running = await socketAnswers(socketPath);
  return {
    state: running ? "running" : appPath ? "stopped" : "not-installed",
    appPath,
    version: appPath ? await appVersion(appPath) : null,
    socketPath,
  };
}
