import { maximizedPaneIdAtom, splitLayoutAtom } from "@/lib/split-layout/atoms";
import {
  countPanes,
  findPane,
  removePane,
  replacePaneContent,
  setFocus,
  type SplitLayout,
} from "@/lib/split-layout";
import { focusedPaneRoute, paneContentRoute } from "./splitThreadNavigation";

interface SplitPaneActionStore {
  get(atom: typeof splitLayoutAtom): SplitLayout | null;
  get(atom: typeof maximizedPaneIdAtom): string | null;
  set(atom: typeof splitLayoutAtom, value: SplitLayout): void;
}

export interface SplitPaneActionArgs {
  store: SplitPaneActionStore;
  navigate: (route: string, options: { replace: true }) => void;
  setMaximizedPaneId: (paneId: string | null) => void;
  paneId: string;
}

export function focusSplitPane({
  store,
  navigate,
  setMaximizedPaneId,
  paneId,
}: SplitPaneActionArgs): boolean {
  const current = store.get(splitLayoutAtom);
  if (current === null) return false;
  const pane = findPane(current.root, paneId);
  if (current.focusedPaneId === paneId) return pane !== null;
  store.set(splitLayoutAtom, setFocus(current, paneId));
  if (store.get(maximizedPaneIdAtom) !== null) {
    setMaximizedPaneId(paneId);
  }
  if (pane === null) return false;
  navigate(paneContentRoute(pane.content), { replace: true });
  return true;
}

export function closeSplitPane({
  store,
  navigate,
  setMaximizedPaneId,
  paneId,
}: SplitPaneActionArgs): boolean {
  const current = store.get(splitLayoutAtom);
  if (current === null) return false;
  if (countPanes(current.root) === 1) {
    const pane = findPane(current.root, paneId);
    if (pane === null || pane.content.kind === "new-thread") return false;
    store.set(
      splitLayoutAtom,
      replacePaneContent(current, paneId, { kind: "new-thread" }),
    );
    setMaximizedPaneId(null);
    navigate(paneContentRoute({ kind: "new-thread" }), { replace: true });
    return true;
  }
  const next = removePane(current, paneId);
  if (next === current) return false;
  store.set(splitLayoutAtom, next);
  if (store.get(maximizedPaneIdAtom) === paneId) {
    setMaximizedPaneId(null);
  }
  if (next.focusedPaneId !== current.focusedPaneId) {
    const route = focusedPaneRoute(next);
    if (route !== null) {
      navigate(route, { replace: true });
    }
  }
  return true;
}
