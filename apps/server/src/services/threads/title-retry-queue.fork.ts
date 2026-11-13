export const MAX_TITLE_RETRIES = 3;
export const TITLE_RETRY_DELAY_MS = 11_000;

export type TitleRetryResult = "done" | "again";

interface QueuedTitleRetry {
  attempts: number;
  running: boolean;
  run: () => Promise<TitleRetryResult>;
}

const queued = new Map<string, QueuedTitleRetry>();

export function queueTitleRetry(
  threadId: string,
  run: () => Promise<TitleRetryResult>,
): void {
  if (queued.has(threadId)) return;
  queued.set(threadId, { attempts: 0, running: false, run });
}

export function dropTitleRetry(threadId: string): void {
  queued.delete(threadId);
}

export function hasTitleRetry(threadId: string): boolean {
  return queued.has(threadId);
}

export async function runQueuedTitleRetry(threadId: string): Promise<void> {
  const entry = queued.get(threadId);
  if (entry === undefined || entry.running) return;
  entry.running = true;
  entry.attempts += 1;
  let result: TitleRetryResult = "again";
  try {
    result = await entry.run();
  } catch {
    result = "again";
  } finally {
    entry.running = false;
  }
  if (result === "done" || entry.attempts >= MAX_TITLE_RETRIES) {
    if (queued.get(threadId) === entry) queued.delete(threadId);
  }
}

export function scheduleQueuedTitleRetry(
  threadId: string,
  delayMs: number = TITLE_RETRY_DELAY_MS,
): void {
  if (!queued.has(threadId)) return;
  const timer = setTimeout(() => void runQueuedTitleRetry(threadId), delayMs);
  timer.unref();
}
