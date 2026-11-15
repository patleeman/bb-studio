import type { WorkCard } from "../contract";
import { isFinished } from "../shared";
import { shownStep } from "./model";

export function inFlightRows(cards: readonly WorkCard[]): WorkCard[] {
  return cards.some((card) => !isFinished(card)) ? [...cards] : [];
}

export function splitRows(cards: readonly WorkCard[]): { live: WorkCard[]; finished: WorkCard[] } {
  return { live: cards.filter((card) => !isFinished(card)), finished: cards.filter(isFinished) };
}

export function openCount(cards: readonly WorkCard[]): number {
  return cards.filter((card) => !isFinished(card)).length;
}

export function needsYouCount(cards: readonly WorkCard[]): number {
  return cards.filter((card) => card.state === "needs-you").length;
}

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
