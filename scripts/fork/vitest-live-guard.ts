import { afterEach } from "vitest";

// Tests never reach a live bb or BB Studio. An agent shell exports the live
// server's URL, data folder and thread context; a test that reads
// BB_SERVER_URL (bb-app's config tests do) would otherwise call the live
// server. Each test file starts with these cleared, and a test that leaves
// BB_SERVER_URL pointing at a live server's port fails.

export const INHERITED_BB_ENV_KEYS: readonly string[] = [
  "BB_CLI",
  "BB_CLI_DIR",
  "BB_CLI_LAUNCHER",
  "BB_DATA_DIR",
  "BB_ENVIRONMENT_ID",
  "BB_HOST_DAEMON_PORT",
  "BB_PROJECT_ID",
  "BB_SERVER_PORT",
  "BB_SERVER_URL",
  "BB_THREAD_ID",
  "BB_THREAD_STORAGE",
];

/** BB Studio's (38986) and stock bb's (38886) live server ports. */
const LIVE_SERVER_PORTS: ReadonlySet<string> = new Set(["38986", "38886"]);

export function pointsAtLiveServer(value: string | undefined): boolean {
  if (value === undefined) return false;
  try {
    return LIVE_SERVER_PORTS.has(new URL(value.trim()).port);
  } catch {
    return false;
  }
}

export function clearInheritedBbEnv(env: NodeJS.ProcessEnv): void {
  for (const key of INHERITED_BB_ENV_KEYS) {
    delete env[key];
  }
}

clearInheritedBbEnv(process.env);

afterEach(() => {
  const url = process.env.BB_SERVER_URL;
  if (pointsAtLiveServer(url)) {
    delete process.env.BB_SERVER_URL;
    throw new Error(
      `BB_SERVER_URL points at a live server (${url}). Tests must use their own server.`,
    );
  }
});
