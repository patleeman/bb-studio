import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { useEffect } from "react";
import { renameTabOf, workbenchOf } from "../../kit/app/host-sdk";
import { STUDIO_PLUGIN_ID } from "../../kit/contract";
import { LOOPS_PANE } from "./hooks";

export const TODOS_TAB_TITLE = "Todos";
export const RENAME_SETTLE_MS = 400;
const AGAIN_ON = ["storage", "focus", "pointerup", "keyup", "popstate"] as const;

export function keepTodosTabName(navigate: object, view: Pick<Window, "addEventListener" | "removeEventListener" | "setTimeout" | "clearTimeout">): () => void {
  const rename = renameTabOf(navigate);
  if (!rename) return () => {};
  let timer: ReturnType<Window["setTimeout"]> | null = null;
  const run = () => {
    timer = null;
    try {
      rename({ tab: { id: LOOPS_PANE }, title: TODOS_TAB_TITLE });
      for (const tab of workbenchOf(navigate)?.list().tabs ?? []) {
        const detail = tab.detail;
        if (tab.title === TODOS_TAB_TITLE || detail?.kind !== "plugin" || !("pluginId" in detail) || detail.pluginId !== STUDIO_PLUGIN_ID || detail.tab.id !== LOOPS_PANE) continue;
        rename({ tab: { id: LOOPS_PANE }, ...(detail.params == null ? {} : { params: detail.params }), title: TODOS_TAB_TITLE });
      }
    } catch { return; }
  };
  const soon = () => {
    if (timer !== null) view.clearTimeout(timer);
    timer = view.setTimeout(run, RENAME_SETTLE_MS);
  };
  run();
  soon();
  for (const name of AGAIN_ON) view.addEventListener(name, soon, true);
  return () => {
    if (timer !== null) view.clearTimeout(timer);
    for (const name of AGAIN_ON) view.removeEventListener(name, soon, true);
  };
}

export function TodosTabName() {
  const navigate = useBbNavigate();
  useEffect(() => keepTodosTabName(navigate, window), [navigate]);
  return null;
}
