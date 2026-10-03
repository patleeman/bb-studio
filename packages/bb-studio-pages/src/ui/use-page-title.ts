import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { PageMetaView } from "../contract";
import type { Rpc } from "./shared";
import { PageTitle, TitleRecovery } from "./page-title";

export function usePageTitle(page: PageMetaView, rpc: Rpc) {
  const origin = location.origin;
  const controller = useMemo(() => new PageTitle(page.id, page, {
    update: input => rpc.call("update", input),
    get: input => rpc.call("get", input),
  }, new TitleRecovery(origin, page.id)), [page.id, rpc, origin]);
  useEffect(() => { controller.attach(); return () => controller.dispose(); }, [controller]);
  useEffect(() => controller.observe(page), [controller, page.title, page.updatedAt]);
  const state = useSyncExternalStore(controller.subscribe, () => controller.snapshot);
  return { ...state, controller };
}
