// Bring things over: Agent Plugins becomes an import into Studio's Tool
// Gateway instead of a plugin to add. This copies bb's Agent Plugins database
// (one consistent backup, as adding a plugin does) to
// plugins/studio/secrets/tool-gateway/agent-plugins-import.db. It holds the
// servers' env and header values in plain text, so it lives in Studio's
// secrets folder: private (folders 0700, file 0600), never copied by a
// bring-over, and kept apart from Studio-data staging (import-staged), which
// neither replaces nor deletes it. Studio shows the servers to import, the
// user's tick in the app window is the approval, and Studio deletes the copy
// once the import has run. bb's secrets folder is not copied.
import { chmod, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { BringOverError, exists } from "./files.js";
import { snapshotDatabases } from "./snapshot.js";

export const AGENT_PLUGINS_ID = "agent-plugins";
export const TOOL_GATEWAY_STAGED = [
  "plugins",
  "studio",
  "secrets",
  "tool-gateway",
  "agent-plugins-import.db",
] as const;

export async function stageToolGateway(args: {
  sourceDataDir: string;
  dataDir: string;
}): Promise<{ staged: string }> {
  const from = join(args.sourceDataDir, "plugins", AGENT_PLUGINS_ID, "data.db");
  if (!(await exists(from))) {
    throw new BringOverError("bb has no Agent Plugins data to import");
  }
  const to = join(args.dataDir, ...TOOL_GATEWAY_STAGED);
  const folder = join(to, "..");
  await mkdir(folder, { recursive: true, mode: 0o700 });
  // mkdir doesn't tighten folders that are already there.
  await chmod(join(folder, ".."), 0o700);
  await chmod(folder, 0o700);
  for (const suffix of ["", "-wal", "-shm"]) {
    await rm(`${to}${suffix}`, { force: true });
  }
  await snapshotDatabases([{ from, to }]);
  await chmod(to, 0o600);
  return { staged: to };
}
