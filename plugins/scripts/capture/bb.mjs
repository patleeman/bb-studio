import { runText } from "./process.mjs";
import { readStagedInstance, captureEnv } from "../staged-instance.mjs";
export const instance = readStagedInstance();
export const serverUrl = instance.serverUrl;
export const cdpPort = instance.cdpPort;
export const projectId = process.env.BB_CAPTURE_PROJECT_ID;
export const threadId = process.env.BB_CAPTURE_THREAD_ID;
export const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
export async function pluginRpc(pluginId, method, input) {
  const response = await fetch(`${serverUrl}/api/v1/plugins/${pluginId}/rpc/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error?.message ?? `Plugin RPC failed: ${pluginId}/${method}`);
  }
  return payload.result;
}

/** Run the bb CLI as the owner, not as the thread this script may run inside. */
export async function bbCli(args) {
  return runText(instance.cli, args, { env: captureEnv(instance) });
}
