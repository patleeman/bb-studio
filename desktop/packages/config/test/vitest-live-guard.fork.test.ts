import { describe, expect, it } from "vitest";

// scripts/fork/vitest-live-guard.ts clears these in every test file, so no
// test reads an agent shell's live server, data folder or thread.
const CLEARED = [
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

describe("the vitest live-server guard", () => {
  it("starts each test file without the agent shell's bb env", () => {
    for (const key of CLEARED) {
      expect(process.env[key], key).toBeUndefined();
    }
  });
});
