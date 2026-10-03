import { spawn } from "node:child_process";
// Captures run against a staged BB (scripts/staged-bb.mjs), never the BB you
// work in, whose projects, threads, and channels are private.
if (!process.env.BB_SERVER_URL || !process.env.BB_DATA_DIR)
  throw new Error('Source a staged BB\'s capture.env first: node scripts/staged-bb.mjs start, then . "$TMPDIR/bb-studio-staged/capture.env".');
export const serverUrl = process.env.BB_SERVER_URL.replace(/\/$/, "");
export const cdpPort = Number(process.env.BB_CAPTURE_CDP_PORT ?? "9222");
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

// Saved view fixture seeded by staged-bb.mjs.
export const launchRoomReplies = [
 "Ready. I'll keep the decision log for ORBIT-42 and post next steps after each check.",
 "Release check passed: the brief, owner, and Friday window all line up.",
 "Logged: release check passed. Next step: confirm the Friday release window.",
];
let launchRoomId = null;
export async function launchRoomThread() {
 const views = await pluginRpc("studio", "teams_views",{});
 const view=views.find(v=>v.name==="Launch work"&&!v.archived);
 if(!view)throw new Error("Seed Launch work before capturing.");
 const page=await pluginRpc("studio", "teams_view",{id:view.id});
 for(const reply of launchRoomReplies)if(!page.entries.some(e=>e.role==="assistant"&&e.text.startsWith(reply.slice(0,40))))throw new Error(`Missing seeded reply: ${reply}`);
 launchRoomId=view.id;
 return page.threads[0]?.id;
}

/** Run the bb CLI as the owner, not as the thread this script may run inside. */
export async function bbCli(args) {
  const env = { ...process.env };
  delete env.BB_THREAD_ID;
  const child = spawn("bb", args, { env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const code = await new Promise((resolvePromise) => child.on("close", resolvePromise));
  if (code !== 0) throw new Error(`bb ${args.join(" ")} failed: ${stderr || stdout}`);
  return stdout;
}

export const getLaunchRoomId = () => launchRoomId;
