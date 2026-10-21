// One dashboard, loaded and kept current: realtime edits and data, and a
// heartbeat while it's on screen, so the server refreshes its URL and script
// widgets only while someone looks.
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
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
  const latest = useRef(0);
  const seen = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const { dashboard: next } = await rpc.call("dashboards.get", { id });
      if (ticket !== latest.current) return;
      seen.current = next?.updatedAt ?? 0;
      setDashboard(next as DashboardView | null);
    } catch (error) {
      if (ticket === latest.current) toast.error(errorMessage(error));
    }
  }, [id, rpc]);

  useEffect(() => { void load(); }, [load]);

  useRealtime(REALTIME_CHANNEL, (payload) => {
    const event = payload as { type?: string; dashboardId?: string; updatedAt?: number } | null;
    if (event?.dashboardId !== id) return;
    if (event.type === DASHBOARD_UPDATE_TYPE && event.updatedAt !== undefined && event.updatedAt <= seen.current) return;
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
    seen.current = Math.max(seen.current, next.updatedAt);
    setDashboard(next);
  }, []);

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
      seen.current = Math.max(seen.current, updatedAt);
      setDashboard((current) => (current ? { ...current, layouts, updatedAt } : current));
    } catch (error) {
      toast.error(errorMessage(error));
      void load();
    }
  }, [id, load, rpc]);

  const rename = useCallback((next: string) => {
    const name = next.trim();
    if (!name) return;
    setDashboard((current) => (current ? { ...current, name } : current));
    void rpc.call("dashboards.rename", { id, name }).catch((error) => toast.error(errorMessage(error)));
  }, [id, rpc]);

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

  return { dashboard, load, edit, saveLayout, rename, refresh, revoke, apply, rpc };
}
