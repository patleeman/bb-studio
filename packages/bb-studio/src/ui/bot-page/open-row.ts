import * as sdkApp from "@get-bb/plugin-sdk/app";
import type { JsonValue } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { refDragItem, type DragItem } from "../../kit/app/item-drag";
import { openAppPath } from "../../kit/app/nav";
import { clickModifiers, openLinkFromAnywhere, type CardClick } from "../../links/open";
import { linkFor, parseLink } from "../../links/router";
import { refOfTab, type TabRef } from "../../tab-kinds";

export const ROW_LINK_ATTR = "data-row-link";

export interface PanelTabsView {
  open: boolean;
  selectedKey: string | null;
  tabs: readonly { key: string; detail: { kind: string; pluginId?: string; tab?: { id: string }; params?: JsonValue | null } }[];
}

const panelTabsHook = Object.entries(sdkApp).find(([key]) => key === "experimental_usePanelTabs")?.[1];
const usePanelTabs: () => PanelTabsView | null = typeof panelTabsHook === "function" ? (panelTabsHook as () => PanelTabsView) : () => null;

export function openLinksOf(tabs: PanelTabsView | null): { open: readonly string[]; selected: string | null } {
  if (!tabs?.open) return { open: [], selected: null };
  const links = tabs.tabs.flatMap((tab) => {
    const ref = tab.detail.kind === "plugin" && tab.detail.pluginId && tab.detail.tab ? refOfTab({ pluginId: tab.detail.pluginId, tabId: tab.detail.tab.id, params: tab.detail.params ?? null }) : null;
    return ref ? [{ key: tab.key, link: linkFor(ref) }] : [];
  });
  return { open: links.map((each) => each.link), selected: links.find((each) => each.key === tabs.selectedKey)?.link ?? null };
}

export function rowLink(target: TabRef | string): { link: string; ref: TabRef | null } {
  if (typeof target !== "string") return { link: linkFor(target), ref: target };
  const parsed = parseLink(target);
  if (parsed?.type !== "entity") return { link: target, ref: null };
  const ref = parsed.ref.kind === "worker" ? { kind: "conversation" as const, id: parsed.ref.id } : parsed.ref;
  return { link: linkFor(ref), ref };
}

export function focusClosedRow(closed: readonly string[], root: Pick<Document, "activeElement" | "body" | "querySelectorAll"> | null = typeof document === "undefined" ? null : document): boolean {
  if (!root || !closed.length) return false;
  const active = root.activeElement;
  if (active && active !== root.body) return false;
  for (const row of root.querySelectorAll<HTMLElement>(`[${ROW_LINK_ATTR}]`)) {
    if (!closed.includes(row.getAttribute(ROW_LINK_ATTR) ?? "")) continue;
    const button = row.querySelector<HTMLElement>("button");
    if (!button) continue;
    button.focus();
    return true;
  }
  return false;
}

export interface RowOpenProps {
  link: string;
  selected: boolean;
  onOpen(event: CardClick): void;
  dragItem: DragItem | null;
}

export function useRowOpen(): (target: TabRef | string, title?: string | null) => RowOpenProps {
  const tabs = usePanelTabs();
  const [last, setLast] = useState<string | null>(null);
  const shown = useMemo(() => openLinksOf(tabs), [tabs]);
  const openKey = shown.open.join("\n");
  const was = useRef<readonly string[]>(shown.open);
  useEffect(() => {
    const now = openKey ? openKey.split("\n") : [];
    const closed = was.current.filter((link) => !now.includes(link));
    was.current = now;
    if (closed.length) setLast((current) => (current && closed.includes(current) ? null : current));
    focusClosedRow(closed);
  }, [openKey]);
  const selected = tabs?.open ? shown.selected : last;
  return useCallback((target, title) => {
    const { link, ref } = rowLink(target);
    return {
      link,
      selected: link === selected,
      dragItem: ref ? refDragItem(ref, title) : null,
      onOpen: (event) => {
        if (!ref) { if (link.startsWith("/")) openAppPath(link); return; }
        setLast(link);
        void openLinkFromAnywhere(link, { source: "botPage", title: title ?? null, modifiers: clickModifiers(event) });
      },
    };
  }, [selected]);
}
