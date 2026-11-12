// Full size, in place: a page's whiteboard opens in the full editor over the
// page's own box (the Studio tab, a thread's side panel or workbench), never
// by navigating to Studio. The page stays mounted underneath, so the editor's
// Back ("Page") or Esc return to it at the same scroll.
import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

const DrawingEditor = lazy(() => import("../../draw/ui/drawing-editor").then((module) => ({ default: module.DrawingEditor })));

type Expand = (drawingId: string) => void;
const ExpandContext = createContext<Expand | null>(null);

/** Opens a whiteboard full size where the page is; null outside a page host. */
export function useExpandWhiteboard(): Expand | null {
  return useContext(ExpandContext);
}

/** Esc leaves full size unless the editor used it (a text box, a menu, a selection). */
export function leavesFullSize(event: Pick<KeyboardEvent, "key" | "defaultPrevented" | "target">): boolean {
  if (event.key !== "Escape" || event.defaultPrevented) return false;
  const target = event.target as HTMLElement | null;
  return !target?.closest?.("textarea, input, [contenteditable='true'], [role='menu'], [role='dialog']");
}

/** Wraps a page's contents; the whiteboard covers this box (its parent is `relative`). */
export function WhiteboardExpandHost({ threadId, children }: { threadId?: string | null; children: ReactNode }) {
  const [open, setOpen] = useState<string | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const expand = useCallback<Expand>((drawingId) => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(drawingId);
  }, []);
  const close = useCallback(() => {
    setOpen(null);
    const back = returnFocus.current;
    returnFocus.current = null;
    requestAnimationFrame(() => back?.isConnected && back.focus({ preventScroll: true }));
  }, []);
  useEffect(() => {
    if (!open) return;
    // Bubble phase, after Excalidraw: Esc it handled (deselect, close a menu) stays there.
    const onKey = (event: KeyboardEvent) => { if (leavesFullSize(event)) { event.preventDefault(); close(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);
  const value = useMemo(() => expand, [expand]);
  return (
    <ExpandContext.Provider value={value}>
      {children}
      {open ? (
        <div role="region" aria-label="Whiteboard, full size" data-whiteboard-full-size={open} className="absolute inset-0 z-40 flex flex-col bg-background">
          <Suspense fallback={null}>
            <DrawingEditor drawingId={open} threadId={threadId ?? null} backLabel="Page" onBack={close} inlineHeader />
          </Suspense>
        </div>
      ) : null}
    </ExpandContext.Provider>
  );
}
