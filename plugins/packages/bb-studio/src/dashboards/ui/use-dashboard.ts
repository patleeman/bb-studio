// One dashboard, loaded and kept current: realtime edits and data, and a
// heartbeat while it's on screen, so the server refreshes its URL and script
// widgets only while someone looks.
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { readAvailable } from "../../kit/server/read-available";
import { errorMessage } from "../../kit/format";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../contract";
import { DASHBOARD_UPDATE_TYPE, DATA_UPDATE_TYPE, REALTIME_CHANNEL, type DashboardView, type Layouts, type Op } from "../shared";

const HEARTBEAT_MS = 30_000;
/** One id per window, so the server counts viewers. */
const CLIENT_ID = `c_${Math.random().toString(36).slice(2, 12)}`;

export function useDashboard(id: string) {
  const rpc = useRpc<typeof rpcContract>();
  const [dashboard, setDashboard] = useState<DashboardView | null | undefined>(undefined);
  const current = useRef({ id, latest: 0, seen: 0, view: undefined as DashboardView | null | undefined });
  if (current.current.id !== id) current.current = { id, latest: 0, seen: 0, view: undefined };
  const scope = current.current;

  // Every writer uses this gate. Equal document revisions can contain newer
  // data, approvals or library HTML; request tickets order those snapshots.
  const accept = useCallback((next: DashboardView | null, mutation = false) => {
    if (current.current !== scope || (next && (next.id !== id || next.updatedAt < scope.seen))) return false;
    if (mutation) ++scope.latest;
    scope.seen = next?.updatedAt ?? 0;
    scope.view = next;
    setDashboard(next);
    return true;
  }, [id, scope]);

  const load = useCallback(async () => {
    const ticket = ++scope.latest;
    const result = await readAvailable(() => rpc.call("dashboards.get", { id }));
    if (current.current !== scope || ticket !== scope.latest) return;
    if (result.status === "unavailable") { toast.error(errorMessage(result.error)); return; }
    accept(result.status === "absent" ? null : result.value.dashboard as DashboardView | null);
  }, [accept, id, rpc, scope]);

  useEffect(() => {
    setDashboard(undefined);
    void load();
    return () => { ++scope.latest; };
  }, [load, scope]);

  useRealtime(REALTIME_CHANNEL, (payload) => {
    const event = payload as { type?: string; dashboardId?: string } | null;
    if (event?.dashboardId !== id) return;
    // Both event types invalidate the complete view, including changes that
    // don't edit the document (approval, widget types and refreshed data).
    if (event.type === DASHBOARD_UPDATE_TYPE || event.type === DATA_UPDATE_TYPE) void load();
  });

  // Heartbeat while the page is visible; leave when it closes or hides.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const beat = () => void rpc.call("dashboards.view", { id, clientId: CLIENT_ID }).catch(() => {});
    const leave = () => void rpc.call("dashboards.view", { id, clientId: CLIENT_ID, leave: true }).catch(() => {});
    const start = () => {
      if (timer) return;
      beat();
      timer = setInterval(beat, HEARTBEAT_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") { start(); void load(); }
      else { stop(); leave(); }
    };
    if (document.visibilityState !== "hidden") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
      leave();
    };
  }, [id, rpc, load]);

  const apply = useCallback((next: DashboardView) => {
    if (accept(next, true)) void load();
  }, [accept, load]);

  const edit = useCallback(async (ops: Op[]): Promise<DashboardView | null> => {
    try {
      const { dashboard: next } = await rpc.call("dashboards.edit", { id, ops });
      apply(next as DashboardView);
      return next as DashboardView;
    } catch (error) {
      toast.error(errorMessage(error));
      return null;
    }
  }, [apply, id, rpc]);

  const saveLayout = useCallback(async (layouts: Layouts) => {
    try {
      const { updatedAt } = await rpc.call("dashboards.saveLayout", { id, layouts });
      if (scope.view && accept({ ...scope.view, layouts, updatedAt }, true)) await load();
    } catch (error) {
      toast.error(errorMessage(error));
      void load();
    }
  }, [accept, id, load, rpc, scope]);

  const rename = useCallback((next: string) => {
    const name = next.trim();
    if (!name) return;
    if (scope.view) accept({ ...scope.view, name }, true);
    void rpc.call("dashboards.rename", { id, name }).then(({ updatedAt }) => {
      if (scope.view && accept({ ...scope.view, name, updatedAt }, true)) return load();
    }).catch((error) => { toast.error(errorMessage(error)); void load(); });
  }, [accept, id, load, rpc, scope]);

  const refresh = useCallback(async (widgetId?: string) => {
    try {
      const { refreshed } = await rpc.call("dashboards.refresh", { id, ...(widgetId ? { widgetId } : {}) });
      if (!refreshed.length) toast.info(widgetId ? "Refreshed less than 10 seconds ago." : "Nothing to refresh right now.");
      await load();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }, [id, load, rpc]);

  const revoke = useCallback(async (widgetId: string) => {
    await rpc.call("dashboards.revokeScript", { id, widgetId }).catch((error) => toast.error(errorMessage(error)));
    await load();
  }, [id, load, rpc]);

  return { dashboard: dashboard?.id && dashboard.id !== id ? undefined : dashboard, load, edit, saveLayout, rename, refresh, revoke, apply, rpc };
}
