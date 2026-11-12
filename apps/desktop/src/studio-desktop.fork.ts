import { app } from "electron";
import { join } from "node:path";
import {
  STUDIO_BUILD,
  formatStudioAboutVersion,
  type StudioUpdateTest,
} from "./studio-release.fork.js";

export function applyStudioUpdateTest(
  test: StudioUpdateTest | null,
  env: NodeJS.ProcessEnv,
  setUserDataPath: (path: string) => void,
  appendSwitch: (name: string, value: string) => void,
): void {
  if (test === null) return;
  env.BB_DATA_DIR = join(test.root, "data");
  env.BB_SERVER_PORT = String(test.serverPort);
  env.BB_HOST_DAEMON_PORT = String(test.hostDaemonPort);
  env.BB_STUDIO_IMPORT_FROM = "off";
  env.BB_SKIP_ONBOARDING = "1";
  setUserDataPath(join(test.root, "user-data"));
  appendSwitch("remote-debugging-port", String(test.debugPort));
}

applyStudioUpdateTest(
  STUDIO_BUILD?.test ?? null,
  process.env,
  (path) => app.setPath("userData", path),
  (name, value) => app.commandLine.appendSwitch(name, value),
);

export function studioAboutVersion(version: string): string {
  return formatStudioAboutVersion(version, STUDIO_BUILD);
}
