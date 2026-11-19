// BB Studio's "Bring things over from bb" (the fork's /api/v1/fork/bring-over
// routes): what the old bb install has, and a job that brings picked projects,
// threads and settings over while BB Studio runs. On a BB without the routes,
// or with no bb install, `available` is false and nothing is shown.

export interface BringOverProject { id: string; name: string; threads: number; threadsHere: number; lastActivityAt: number | null; joins: { id: string; name: string } | null }
export interface BringOverThread { id: string; title: string; updatedAt: number; archived: boolean; attachments: number; here: boolean }
export interface BringOverSetting { id: string; label: string; detail: string; secret: boolean; count: number; names?: string[]; alreadyHere?: string[] }
export interface BringOverPlugin { id: string; version: string | null; source: string; sourceKind: string; enabled: boolean; hasData: boolean; here: boolean; sourceMissing: boolean; needsNewer?: string | null }
export interface BringOverJob {
  id: string;
  state: "running" | "done" | "failed" | "cancelled";
  threadsTotal: number;
  threadsDone: number;
  threadsImported: number;
  threadsSkipped: number;
  files: number;
  settingsApplied: string[];
  failures: { item: string; detail: string }[];
}
export interface BringOverState {
  available: boolean;
  sourceDataDir?: string;
  readAt?: number | null;
  projects?: BringOverProject[];
  settings?: BringOverSetting[];
  plugins?: BringOverPlugin[];
  job?: BringOverJob | null;
  studioData?: BringOverStudioData;
}
export type StudioImportState = "staging" | "staged" | "ready" | "applying" | "applied" | "refused" | "failed" | "rollback-failed" | "restore-requested" | "restoring" | "restored";
/** bb's Studio data as the server sees it: in bb, its size, and where a bring-over of it is (the journal). */
export interface BringOverStudioData {
  inBb: boolean;
  bots: number;
  pages: number;
  tasks: number;
  journal: { state: StudioImportState; error: string | null; stagedAt: number; appliedAt?: number | null; restoredAt?: number | null } | null;
}
export interface BringOverRequest {
  picks: { kind: "project" | "thread"; id: string }[];
  attachments: boolean;
  settings: { id: string; replace: boolean }[];
  /** Bringing over BB Studio data: the Bots' own threads, which must all come over. */
  studioData?: { required: string[] };
}

const BASE = "/api/v1/fork/bring-over";

async function errorOf(response: Response): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as { message?: unknown; error?: unknown };
  if (typeof body.message === "string") return body.message;
  if (typeof body.error === "string") return body.error;
  return `BB Studio answered ${String(response.status)}`;
}

async function send<T>(path: string, init: RequestInit | undefined, load: typeof fetch): Promise<T> {
  const response = await load(`${BASE}${path}`, init);
  if (!response.ok) throw new Error(await errorOf(response));
  return (await response.json()) as T;
}

const gatedPost = (token: string, body?: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json", "x-bb-studio-ui-token": token }, body: JSON.stringify(body ?? {}) });

type DesktopBridge = { bbDesktop?: { experimental_bringOverToken?: () => Promise<string | null> } };
let token: Promise<string | null> | null = null;
/** This launch's token from BB Studio's own window; null in a browser or on a phone, where bringing things over is refused. */
export function uiToken(): Promise<string | null> {
  token ??= (async () => {
    try {
      return (await (globalThis as DesktopBridge).bbDesktop?.experimental_bringOverToken?.()) ?? null;
    } catch {
      return null;
    }
  })();
  return token;
}
export function resetUiTokenForTests(): void { token = null; }

/** Whether bb is on this Mac and the last bring-over, without reading bb's listing. */
export async function readBringOverSummary(load: typeof fetch = fetch): Promise<BringOverState> {
  try {
    const response = await load(`${BASE}?summary=1`);
    if (!response.ok) return { available: false };
    const state = (await response.json()) as BringOverState;
    return typeof state?.available === "boolean" ? state : { available: false };
  } catch {
    return { available: false };
  }
}

export async function readBringOver(load: typeof fetch = fetch): Promise<BringOverState> {
  try {
    const response = await load(BASE);
    if (!response.ok) return { available: false };
    const state = (await response.json()) as BringOverState;
    return typeof state?.available === "boolean" ? state : { available: false };
  } catch {
    return { available: false };
  }
}

export const readBb = (token: string, load: typeof fetch = fetch) => send<BringOverState>("/snapshot", gatedPost(token), load);
export const listProjectThreads = (projectId: string, load: typeof fetch = fetch) => send<BringOverThread[]>(`/projects/${encodeURIComponent(projectId)}/threads`, undefined, load);
export const startBringOver = (request: BringOverRequest, token: string, load: typeof fetch = fetch) => send<BringOverJob>("/jobs", gatedPost(token, request), load);
export const currentJob = (load: typeof fetch = fetch) => send<{ job: BringOverJob | null }>("/jobs/current", undefined, load);
export const cancelBringOver = (token: string, load: typeof fetch = fetch) => send<{ job: BringOverJob | null }>("/jobs/current/cancel", gatedPost(token), load);

export interface BringOverGate { fromApp: boolean; matches: boolean }
/** Whether the server was started by this app and takes this window's token. Null when the server can't say (an older BB Studio). */
export async function readGate(token: string, load: typeof fetch = fetch): Promise<BringOverGate | null> {
  try {
    const response = await load(`${BASE}/gate`, { headers: { "x-bb-studio-ui-token": token } });
    if (!response.ok) return null;
    const gate = (await response.json()) as BringOverGate;
    return typeof gate?.matches === "boolean" && typeof gate.fromApp === "boolean" ? gate : null;
  } catch {
    return null;
  }
}

async function sendEmpty(path: string, init: RequestInit, load: typeof fetch): Promise<void> {
  const response = await load(`${BASE}${path}`, init);
  if (!response.ok) throw new Error(await errorOf(response));
}

/** bb's Studio data and where a bring-over of it is; null on a BB without the route. */
export async function readStudioData(load: typeof fetch = fetch): Promise<BringOverStudioData | null> {
  try {
    const response = await load(`${BASE}/studio-data`);
    return response.ok ? ((await response.json()) as BringOverStudioData) : null;
  } catch {
    return null;
  }
}
/** Copies bb's Studio data into a staging folder; nothing here changes yet. */
export const copyStudioData = (token: string, load: typeof fetch = fetch) => send<{ studioData: BringOverStudioData }>("/studio-data", gatedPost(token), load);
export const discardStudioData = (token: string, load: typeof fetch = fetch) => sendEmpty("/studio-data/discard", gatedPost(token), load);
export const putBackStudioData = (token: string, load: typeof fetch = fetch) => sendEmpty("/studio-data/put-back", gatedPost(token), load);
export const deleteOldStudioData = (token: string, load: typeof fetch = fetch) => sendEmpty("/studio-data/forget", gatedPost(token), load);

const plural = (count: number, word: string, many = `${word}s`) => `${String(count)} ${count === 1 ? word : many}`;

/** "2 Bots · 14 pages · 6 tasks". */
export function studioDataLine(data: Pick<BringOverStudioData, "bots" | "pages" | "tasks">): string {
  return [plural(data.bots, "Bot"), plural(data.pages, "page"), plural(data.tasks, "task")].join(" · ");
}

/** What a staged copy holds (Studio's studioData.status preview). */
export interface StudioDataPreview { bots: number; pages: number; tasks: number; memories: number; threads: { required: string[]; wanted: string[] }; minisWithSecrets: number; watchersWithEnv: number; problem: string | null }

/** The confirm step, in plain words: what is replaced, what comes over, what happens next. */
export function studioDataConfirm(preview: StudioDataPreview): string[] {
  const lines = [
    `Replaces everything in BB Studio's Studio (your Assistant, its chats, pages, memory, tasks and Studio settings) with bb's: ${[plural(preview.bots, "Bot"), plural(preview.pages, "page"), plural(preview.tasks, "task"), plural(preview.memories, "memory", "memories")].join(", ")}, and ${plural(preview.threads.wanted.length, "thread")}.`,
    "Your current Studio data is kept in a folder, not deleted, and you can put it back. Your Assistant's chat stays as a thread with no Bot.",
    "The threads come over first, like any thread you bring over, and stay here even if you put your old data back.",
    "bb's Bots arrive stopped, with their check-ins, runners and watchers off, and Task reminders off. If you resume a Bot here, stop it in bb so it doesn't run twice.",
    "Approvals you gave in bb (mini apps, dashboard scripts, the public skill registry) are asked for again here.",
  ];
  const secrets = [preview.minisWithSecrets > 0 ? `${plural(preview.minisWithSecrets, "mini app")}' API keys` : null, preview.watchersWithEnv > 0 ? `${plural(preview.watchersWithEnv, "watcher")}' environment values` : null].filter(Boolean);
  if (secrets.length > 0) lines.push(`Secrets kept in Studio's data come along: ${secrets.join(" and ")}.`);
  lines.push("Then quit and reopen BB Studio to finish. Open windows and the phone app reconnect after that.");
  return lines;
}

export const addOldPlugin = (id: string, token: string, load: typeof fetch = fetch) => send<{ id: string; data: boolean }>(`/plugins/${encodeURIComponent(id)}/add`, gatedPost(token), load);

/** What a secret setting will do, in one line: the variables it brings and the ones it replaces. */
export function secretLine(setting: BringOverSetting, replace: boolean): string {
  const names = setting.names ?? [];
  const noun = names.length === 1 ? setting.label.toLowerCase().replace(/s$/u, "") : setting.label.toLowerCase();
  const brings = names.length > 0 ? `Brings over ${String(names.length)} ${noun}: ${names.join(", ")}.` : `Brings over ${setting.label.toLowerCase()}.`;
  const replaced = replace ? (setting.alreadyHere ?? []) : [];
  return replaced.length > 0 ? `${brings} Replaces BB Studio's values for ${replaced.join(", ")}.` : brings;
}

/** The job's one line: "12 of 40 threads · 3 already here · 1 failed". */
export function jobLine(job: BringOverJob): string {
  const parts = [`${String(job.threadsDone)} of ${String(job.threadsTotal)} threads`];
  if (job.threadsSkipped > 0) parts.push(`${String(job.threadsSkipped)} already here`);
  if (job.failures.length > 0) parts.push(`${String(job.failures.length)} failed`);
  const state = job.state === "running" ? "Bringing over" : job.state === "done" ? "Done" : job.state === "cancelled" ? "Cancelled" : "Finished with errors";
  return `${state}: ${parts.join(" · ")}`;
}
