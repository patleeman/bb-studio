import type { WorkCard } from "../contract";
import { shownStep } from "./model";

export function rowDetail(card: Pick<WorkCard, "state" | "step" | "line" | "needs">): string | null {
  if (card.state === "needs-you" && card.needs) return card.needs;
  return [shownStep(card), card.line].filter(Boolean).join(" · ") || null;
}

export function messageLinkPath(pathname: string, threadId: string, seq: number): string | null {
  const base = pathname.replace(/\/+$/, "");
  const match = /\/threads\/([^/]+)$/.exec(base);
  if (!match || decodeURIComponent(match[1]!) !== threadId) return null;
  return `${base}#msg=${seq}`;
}
