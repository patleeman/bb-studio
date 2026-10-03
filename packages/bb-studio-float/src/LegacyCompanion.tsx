import { useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { CompanionPlacement } from "@bb-studio/kit/app";

interface View { element: HTMLDivElement; home: HTMLDivElement; placement: CompanionPlacement }
interface Outlet { id: string; token: symbol; element: HTMLDivElement; order: number }
const views = new Map<string, View>();
const outlets = new Map<symbol, Outlet>();
const listeners = new Set<() => void>();
let order = 0;
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const selected = (id: string) => [...outlets.values()].filter(outlet => outlet.id === id).sort((a, b) => b.order - a.order)[0];

function place(view: View, destination: HTMLElement) {
  if (view.element.parentElement === destination) return;
  const focused = view.element.contains(document.activeElement) ? document.activeElement : null;
  const selection = window.getSelection();
  const range = selection?.rangeCount && view.element.contains(selection.anchorNode) ? {
    anchor: selection.anchorNode!, anchorOffset: selection.anchorOffset,
    focus: selection.focusNode!, focusOffset: selection.focusOffset,
  } : null;
  const scroll = [...view.element.querySelectorAll<HTMLElement>("*")].filter(node => node.scrollTop || node.scrollLeft)
    .map(node => ({ node, top: node.scrollTop, left: node.scrollLeft }));
  destination.append(view.element);
  scroll.forEach(({ node, top, left }) => { node.scrollTop = top; node.scrollLeft = left; });
  if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
  if (range && selection) selection.setBaseAndExtent(range.anchor, range.anchorOffset, range.focus, range.focusOffset);
}

function changed() {
  for (const [id, view] of views) place(view, view.placement === "main" ? selected(id)?.element ?? view.home : view.home);
  listeners.forEach(listener => listener());
}

export function LegacyCompanionView({ id, placement, children }: { id: string; placement: CompanionPlacement; children: ReactNode }) {
  const home = useRef<HTMLDivElement>(null);
  const [element] = useState(() => document.createElement("div"));
  useLayoutEffect(() => {
    if (!home.current) return;
    element.className = "flex h-full min-h-0 min-w-0 flex-col";
    element.dataset.bbPlugin = "float";
    element.dataset.bbPluginRoot = "";
    element.dataset.bbPortaledOverlay = "";
    views.set(id, { element, home: home.current, placement });
    changed();
  }, [id, placement, element]);
  useLayoutEffect(() => () => {
    if (views.get(id)?.element === element) { views.delete(id); changed(); }
    element.remove();
  }, [id, element]);
  return <div ref={home} className="flex min-h-0 flex-1 flex-col">{createPortal(children, element, id)}</div>;
}

export function LegacyCompanionOutlet({ id }: { id: string }) {
  const [token] = useState(() => Symbol());
  const element = useRef<HTMLDivElement>(null);
  const owns = useSyncExternalStore(subscribe, () => selected(id)?.token === token && views.get(id)?.placement === "main", () => false);
  const focus = () => {
    const outlet = outlets.get(token);
    if (outlet && selected(id)?.token !== token) { outlet.order = ++order; changed(); }
  };
  useLayoutEffect(() => {
    if (!element.current) return;
    const node = element.current;
    outlets.set(token, { id, token, element: node, order: ++order });
    changed();
    node.addEventListener("focusin", focus);
    node.addEventListener("pointerdown", focus);
    return () => {
      node.removeEventListener("focusin", focus); node.removeEventListener("pointerdown", focus);
      outlets.delete(token); changed();
    };
  }, [id, token]);
  return <div ref={element} className="flex h-full min-h-0 flex-1 flex-col" data-legacy-companion-outlet={id}>
    {!owns ? <button className="m-auto rounded-md border border-border px-3 py-2 text-sm" onClick={focus}>Show companion here</button> : null}
  </div>;
}
