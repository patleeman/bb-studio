import type { RoomMessage } from "./contract";

const autoTitlePattern = /^New channel(?: \d+)?$/iu;
export const maxRoomTitleLength = 80;
export const roomTitleThreadPrefix = "Bots channel title · ";
export type TitleWorker = { id: string; status: string; createdAt?: number };
export type TitleTask = { controller: AbortController; promise: Promise<void> };

export function titleWorkerPriority(status: string) {
  if (["active", "starting", "pending"].includes(status)) return 3;
  if (status === "idle") return 2;
  if (status === "error") return 1;
  return 0;
}

/** Blank channels use these names until the first message gives an agent enough context to title them. */
export function isAutoTitlePlaceholder(name: string) {
  return autoTitlePattern.test(name.trim());
}

/** Keep model output suitable for a compact sidebar label. */
export function sanitizeRoomTitle(value: string): string | null {
  const line = value
    .split(/\r?\n/u)
    .map((part) => part.trim())
    .find(Boolean);
  if (!line) return null;
  const title = line
    .replace(/^(?:channel\s+)?title\s*:\s*/iu, "")
    .replace(/^[\s`*_#"']+|[\s`*_#"']+$/gu, "")
    .replace(/\s+/gu, " ")
    .replace(/[.!?;,]+$/u, "")
    .trim()
    .slice(0, maxRoomTitleLength)
    .trim();
  if (!title || /^(?:n\/a|none|pass)$/iu.test(title)) return null;
  return title;
}

export function fallbackRoomTitle(message: RoomMessage): string | null {
  if (message.system) return null;
  const source =
    message.text.trim() ||
    (message.attachments.length
      ? `Files: ${message.attachments.map((attachment) => attachment.name).join(", ")}`
      : "");
  const cleaned = source
    .replace(/@[a-z0-9_.-]+/giu, "")
    .replace(/\s+/gu, " ")
    .trim();
  return (
    sanitizeRoomTitle(cleaned.split(" ").slice(0, 7).join(" ")) ??
    "New conversation"
  );
}
