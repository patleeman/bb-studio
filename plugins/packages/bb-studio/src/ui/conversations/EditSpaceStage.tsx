import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePortalScopeProps } from "../../kit/ui/portal-scope";
import { cn } from "../../kit/ui/utils";

export const MAIN_VIEW_SELECTOR = 'main[data-sidebar="inset"]';
export const STAGE_ATTRIBUTE = "data-studio-edit-space";
const STAGE_STYLE_ID = "studio-edit-space-style";
const STAGE_CSS = `html[${STAGE_ATTRIBUTE}] ${MAIN_VIEW_SELECTOR} { visibility: hidden; }`;
const RECHECK_MS = 400;

export interface StageRect { top: number; left: number; width: number; height: number }

export function findMainView(doc: Document): HTMLElement | null {
  return doc.querySelector<HTMLElement>(MAIN_VIEW_SELECTOR);
}

function rectOf(element: HTMLElement): StageRect | null {
  const box = element.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return null;
  return { top: box.top, left: box.left, width: box.width, height: box.height };
}

function sameRect(a: StageRect | null, b: StageRect | null): boolean {
  return a === b || (!!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height);
}

export function useMainViewRect(enabled: boolean, doc: Document = document): StageRect | null {
  const [rect, setRect] = useState<StageRect | null>(() => {
    const main = enabled ? findMainView(doc) : null;
    return main ? rectOf(main) : null;
  });
  useEffect(() => {
    if (!enabled) { setRect(null); return; }
    const view = doc.defaultView ?? window;
    let watched: HTMLElement | null = null;
    let observer: ResizeObserver | null = null;
    const measure = () => {
      const main = findMainView(doc);
      if (main !== watched) {
        observer?.disconnect();
        watched = main;
        if (main && typeof view.ResizeObserver === "function") { observer = new view.ResizeObserver(measure); observer.observe(main); }
      }
      const next = main ? rectOf(main) : null;
      setRect((current) => (sameRect(current, next) ? current : next));
    };
    measure();
    const timer = view.setInterval(measure, RECHECK_MS);
    view.addEventListener("resize", measure);
    return () => { view.clearInterval(timer); view.removeEventListener("resize", measure); observer?.disconnect(); };
  }, [enabled, doc]);
  return rect;
}

export function EditSpaceStage({ rect, scene, children }: { rect: StageRect; scene: boolean; children: ReactNode }) {
  const scope = usePortalScopeProps();
  useEffect(() => {
    const root = document.documentElement;
    if (!document.getElementById(STAGE_STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STAGE_STYLE_ID;
      style.textContent = STAGE_CSS;
      document.head.appendChild(style);
    }
    root.setAttribute(STAGE_ATTRIBUTE, "");
    return () => root.removeAttribute(STAGE_ATTRIBUTE);
  }, []);
  return createPortal(
    <div {...scope} data-testid="edit-space-stage" data-studio-no-drag="all" className={cn("fixed z-40 flex flex-col text-foreground", !scene && "bg-background")}
      style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}>
      {children}
    </div>,
    document.body,
  );
}
