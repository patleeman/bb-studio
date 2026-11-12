// Seeds bb's own database of a SCRATCH data dir with the fictional threads in
// demo-data.mjs, through bb's real DB helpers (@bb/db). The scratch server must
// be stopped while this runs. No provider is called: the messages are written
// as stored events, the way a finished turn leaves them.
//
//   tsx --conditions=source seed-db.mts <desktop-worktree> <data-dir> <ids-out.json>
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { threads } from "./demo-data.mjs";

const [desktop, dataDir, idsOut] = process.argv.slice(2);
if (!desktop || !dataDir || !idsOut) throw new Error("usage: seed-db.mts <desktop-worktree> <data-dir> <ids-out.json>");
if (resolve(dataDir).includes(".bb-studio") || resolve(dataDir).endsWith("/.bb")) throw new Error("refusing: not a scratch data dir");

const dbmod = await import(pathToFileURL(join(desktop, "packages/db/src/index.ts")).href);
const { createConnection, noopNotifier: hub, createThread, createProject, createEnvironment, insertEvents, createPendingInteraction } = dbmod;

const db = createConnection(join(dataDir, "bb.db"));
const raw = db.$client;
const now = Date.now();

// Start clean, so the script can run again on the same scratch dir.
raw.exec("DELETE FROM pending_interactions; DELETE FROM events; DELETE FROM threads; DELETE FROM environments; DELETE FROM project_sources; DELETE FROM projects WHERE kind <> 'personal';");

// The demo machine's name, so no real host name shows.
raw.prepare("UPDATE hosts SET name = 'studio-mac'").run();
const hostId = raw.prepare("SELECT id FROM hosts LIMIT 1").get().id;

const envs = new Map<string, { projectId: string; envId: string }>();
function envFor(name: string, branch: string) {
  const key = `${name}:${branch}`;
  const known = envs.get(key);
  if (known) return known;
  let projectId = raw.prepare("SELECT id FROM projects WHERE name = ?").get(name)?.id as string | undefined;
  if (!projectId) projectId = createProject(db, hub, { name, source: { type: "local_path", hostId, path: `/home/demo/${name}` } }).project.id;
  const env = createEnvironment(db, hub, {
    projectId, hostId, path: `/home/demo/${name}${branch === "main" ? "" : `-${branch.replace(/\//g, "-")}`}`,
    name, status: "ready", isGitRepo: true, branchName: branch, defaultBranch: "main", providerOwnsPath: false,
  });
  const out = { projectId: projectId!, envId: env.id as string };
  envs.set(key, out);
  return out;
}

const ALPHABET = "23456789abcdefghijkmnpqrstuvwxyz";
const creq = () => "creq_" + Array.from({ length: 10 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");

const ids: Record<string, string> = {};
const messageIds: Record<string, string[]> = {};
const lastSeq: Record<string, number> = {};
for (const spec of threads as any[]) {
  const env = spec.env ? envFor(spec.env, spec.branch ?? "main") : null;
  const thread = createThread(db, hub, {
    projectId: env?.projectId ?? "proj_personal",
    environmentId: env?.envId ?? null,
    providerId: "claude-code",
    status: "idle",
    title: spec.title,
    titleFallback: spec.title,
    parentThreadId: spec.workerOf ? ids[spec.workerOf] : null,
    sourceThreadId: spec.forkOf ? ids[spec.forkOf] : null,
    originKind: spec.forkOf ? "fork" : null,
    originPluginId: null,
    lifecycleOwnerThreadId: null,
    visibility: "visible",
    parentNotifications: "auto",
  });
  const id = thread.id as string;
  ids[spec.key] = id;
  messageIds[spec.key] = [];

  const end = now - spec.ago;
  const turns = spec.turns as [string, string][];
  const start = end - turns.length * 6 * 60_000;
  let seq = 0;
  const rows: any[] = [];
  const push = (type: string, turnId: string, at: number, data: any, item?: { id: string; kind: string }) =>
    rows.push({
      createdAt: at, threadId: id, environmentId: env?.envId ?? null, providerThreadId: "demo-session",
      scope: { kind: "turn", turnId }, sequence: ++seq, type, itemId: item?.id ?? null, itemKind: item?.kind ?? null,
      parentToolCallId: null, data: JSON.stringify(data),
    });
  turns.forEach(([user, reply], index) => {
    const turnId = `turn_${spec.key}_${index}`;
    const at = start + index * 6 * 60_000;
    const a = `msg_${spec.key}_${index}`;
    messageIds[spec.key].push(a);
    const requestId = creq();
    rows.push({
      createdAt: at - 500, threadId: id, environmentId: env?.envId ?? null, providerThreadId: null,
      scope: { kind: "thread" }, sequence: ++seq, type: "client/turn/requested", itemId: null, itemKind: null, parentToolCallId: null,
      data: JSON.stringify({
        direction: "outbound", requestId, source: index === 0 ? "spawn" : "tell", initiator: "user", senderThreadId: null,
        input: [{ type: "text", text: user, mentions: [] }],
        target: index === 0 ? { kind: "thread-start" } : { kind: "new-turn" },
        request: { method: index === 0 ? "thread/start" : "turn/start", params: {} },
        execution: { model: "claude-sonnet-4-5", serviceTier: "default", reasoningLevel: "medium", permissionMode: "accept-edits", source: "client/turn/requested" },
      }),
    });
    push("turn/started", turnId, at, { providerThreadId: "demo-session" });
    push("turn/input/accepted", turnId, at + 500, { providerThreadId: "demo-session", clientRequestId: requestId, scope: { kind: "turn", turnId } });
    push("item/completed", turnId, at + 40_000, { providerThreadId: "demo-session", item: { type: "agentMessage", id: a, text: reply } }, { id: a, kind: "agentMessage" });
    const last = index === turns.length - 1;
    const open = last && (spec.status === "active" || spec.approval);
    if (spec.approval && last) {
      push("item/started", turnId, at + 50_000, {
        providerThreadId: "demo-session",
        item: { type: "commandExecution", id: `cmd_${spec.key}`, command: spec.approval.command, cwd: spec.approval.cwd, status: "inProgress", approvalStatus: "waiting_for_approval" },
      }, { id: `cmd_${spec.key}`, kind: "commandExecution" });
    }
    if (!open) push("turn/completed", turnId, at + 45_000, { providerThreadId: "demo-session", status: spec.status === "error" && last ? "failed" : "completed", ...(spec.status === "error" && last ? { error: { message: "3 links returned 404" } } : {}) });
  });
  insertEvents(db, hub, rows);
  lastSeq[spec.key] = seq;

  if (spec.approval) {
    createPendingInteraction(db, {
      threadId: id, turnId: `turn_${spec.key}_${turns.length - 1}`, providerId: "claude-code",
      providerThreadId: "demo-session", providerRequestId: `req_${spec.key}`,
      payload: JSON.stringify({
        kind: "approval",
        subject: { kind: "command", itemId: `cmd_${spec.key}`, command: spec.approval.command, cwd: spec.approval.cwd, actions: [], sessionGrant: null },
        reason: spec.approval.reason,
        availableDecisions: ["allow_once", "allow_for_session", "deny"],
      }),
    });
  }
  raw.prepare("UPDATE threads SET model_override = 'claude-sonnet-4-5', status = ?, created_at = ?, updated_at = ?, latest_attention_at = ?, status_changed_at = ?, last_read_at = ? WHERE id = ?")
    .run(spec.status ?? "idle", start, end, end, end, end, id);
}

writeFileSync(idsOut, JSON.stringify({ ids, messageIds, lastSeq }, null, 2));
console.log(`seeded ${Object.keys(ids).length} threads`);
