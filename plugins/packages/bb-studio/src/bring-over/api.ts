// BB Studio's "Bring things over from bb" (the fork's /api/v1/fork/bring-over
// routes): what the old bb install has, and a job that brings picked projects,
// threads and settings over while BB Studio runs. On a BB without the routes,
// or with no bb install, `available` is false and nothing is shown.

export interface BringOverProject { id: string; name: string; threads: number; threadsHere: number; lastActivityAt: number | null; joins: { id: string; name: string } | null }
export interface BringOverThread { id: string; title: string; updatedAt: number; archived: boolean; attachments: number; here: boolean }
export interface BringOverSetting { id: string; label: string; detail: string; secret: boolean; count: number }
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
export interface BringOverStudioData { inBb: boolean; offered: boolean; reason: string | null; bots: number; pages: number; tasks: number }
export interface BringOverRequest {
  picks: { kind: "project" | "thread"; id: string }[];
  attachments: boolean;
  settings: { id: string; replace: boolean }[];
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

const post = (body?: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });

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

export const readBb = (load: typeof fetch = fetch) => send<BringOverState>("/snapshot", post(), load);
export const listProjectThreads = (projectId: string, load: typeof fetch = fetch) => send<BringOverThread[]>(`/projects/${encodeURIComponent(projectId)}/threads`, undefined, load);
export const startBringOver = (request: BringOverRequest, load: typeof fetch = fetch) => send<BringOverJob>("/jobs", post(request), load);
export const currentJob = (load: typeof fetch = fetch) => send<{ job: BringOverJob | null }>("/jobs/current", undefined, load);
export const cancelBringOver = (load: typeof fetch = fetch) => send<{ job: BringOverJob | null }>("/jobs/current/cancel", post(), load);
export const bringOverStudioData = (load: typeof fetch = fetch) => send<{ threads: number; threadsHere: number; bots: number }>("/studio-data", post(), load);

/** "2 Bots · 14 pages · 6 tasks". */
export function studioDataLine(data: BringOverStudioData): string {
  const plural = (count: number, word: string) => `${String(count)} ${word}${count === 1 ? "" : "s"}`;
  return [plural(data.bots, "Bot"), plural(data.pages, "page"), plural(data.tasks, "task")].join(" · ");
}

export const addOldPlugin = (id: string, load: typeof fetch = fetch) => send<{ id: string; data: boolean }>(`/plugins/${encodeURIComponent(id)}/add`, post(), load);

/** The job's one line: "12 of 40 threads · 3 already here · 1 failed". */
export function jobLine(job: BringOverJob): string {
  const parts = [`${String(job.threadsDone)} of ${String(job.threadsTotal)} threads`];
  if (job.threadsSkipped > 0) parts.push(`${String(job.threadsSkipped)} already here`);
  if (job.failures.length > 0) parts.push(`${String(job.failures.length)} failed`);
  const state = job.state === "running" ? "Bringing over" : job.state === "done" ? "Done" : job.state === "cancelled" ? "Cancelled" : "Finished with errors";
  return `${state}: ${parts.join(" · ")}`;
}
