// Explore in the app: an explainer's state, realtime events about it, and
// opening it in Explore's side-panel tab.
import type { BbNavigate } from "@get-bb/plugin-sdk/app";
import { openAppPath, openCompanion } from "@bb-studio/kit/app";
import { useEffect, useState } from "react";
import type { RealtimeEvent } from "../constants";
import type { ExplainerView } from "../contract";
import { isActiveJob, PANEL_ACTION } from "../shared";
import { PAGES_PLUGIN_ID, PLUGIN_ID } from "../constants";

export type { ExplainerView };

export const EXPLORE_ICON = "explore/explore";
export const EXPLAINERS_PATH = "explainers";

export const explainerPath = (id: string): string => `/plugins/${PLUGIN_ID}/${EXPLAINERS_PATH}/${encodeURIComponent(id)}`;

/** What a finding's row shows. */
export type RowState = "idle" | "running" | "ready" | "error";

export function rowState(explainer: ExplainerView | null | undefined): RowState {
  if (!explainer) return "idle";
  if (explainer.job && isActiveJob(explainer.job.status)) return "running";
  if (explainer.pageId) return "ready";
  if (explainer.status === "error") return "error";
  return "idle";
}

export type ExplainerEvent = RealtimeEvent;

export function explainerEvent(payload: unknown): ExplainerEvent | null {
  const event = payload as Partial<ExplainerEvent> | null;
  if (event?.type !== "explainer" || typeof event.explainerId !== "string" || typeof event.threadId !== "string" || typeof event.messageId !== "string") return null;
  return { type: "explainer", explainerId: event.explainerId, threadId: event.threadId, messageId: event.messageId, parentId: event.parentId ?? null };
}

/** The `explainer` panel tab's params. */
export function explainerIdFrom(params: unknown): string | null {
  if (!params || typeof params !== "object" || Array.isArray(params)) return null;
  const { explainerId } = params as Record<string, unknown>;
  return typeof explainerId === "string" && explainerId ? explainerId : null;
}

/** Opens one shared companion for an explainer; older installations retain their thread panel. */
export function openExplainer(navigate: BbNavigate, explainer: Pick<ExplainerView, "id" | "label">): boolean {
  if (openCompanion({ kind: "path", path: explainerPath(explainer.id), title: explainer.label })) return true;
  if (navigate.openThreadPanel({ actionId: PANEL_ACTION, title: explainer.label, params: { explainerId: explainer.id } })) return true;
  openAppPath(explainerPath(explainer.id), { main: true });
  return true;
}

/** Pages belongs to another plugin, so use its shared destination rather than an owner-only SDK route. */
export function openExplainerPage(pageId: string): void {
  const path = `/plugins/${PAGES_PLUGIN_ID}/pages/${encodeURIComponent(pageId)}`;
  if (!openCompanion({ kind: "path", path })) openAppPath(path, { main: true });
}

/** Re-renders every minute so "2m ago" stays true. */
export function useMinuteTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 60_000);
    return () => clearInterval(timer);
  }, []);
  return tick;
}
