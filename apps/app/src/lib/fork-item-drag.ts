import type {
  ComposerInsertPart,
  ExperimentalDragItem,
  ExperimentalDropMention,
  ExperimentalItemDropTarget,
} from "@get-bb/plugin-sdk";
import { createComposerHandleBinding } from "@get-bb/plugin-sdk/internal/composer-handle";
import {
  getComposerEditorBridges,
  type ComposerEditorBridge,
} from "./composer-editor-registry";
import { detachedComposerController } from "./plugin-composer-handle";
import type { FixedPanelTab } from "./fixed-panel-tabs-state";
import type { PluginItemDropSlot } from "./fork-slots";
import { panelTabActionTarget } from "./fork-panel-tab-actions";
import { pickZone, zoneBox, type Rect } from "./split-drag/zones";

export const ITEM_DRAG_TYPE = "application/x-bb-item";
export const ITEM_DROP_ATTRIBUTE = "data-fork-item-drop";

const ITEM_KINDS = ["thread", "doc", "tab", "file"] as const;
const COMPOSER_SELECTOR = "[data-composer-box]";
const SIDE_PANEL_CHROME_SELECTOR =
  '[data-testid="thread-secondary-panel-top-chrome"]';
const MAIN_SELECTOR = "[data-app-content-shell]";
const SPLIT_PANE_ATTRIBUTE = "data-split-pane-id";
export const PANEL_TAB_STRIP_SELECTOR =
  '[data-testid="secondary-panel-tab-strip"]';
const PANE_TAB_GROUP_SELECTOR = "[data-sidebar-split-tab-group]";
const TAB_PILL_SELECTOR = "[data-tab-pill]";
export const ITEM_DROP_INDICATOR_ATTRIBUTE = "data-fork-item-drop-indicator";
const INSERTION_BAR_WIDTH_PX = 2;
const NEW_PANE_LABEL = "Split right";

let currentDragItem: ExperimentalDragItem | null = null;

export function getCurrentDragItem(): ExperimentalDragItem | null {
  return currentDragItem;
}

export function setCurrentDragItem(item: ExperimentalDragItem | null): void {
  currentDragItem = item;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDragTab(value: unknown): ExperimentalDragItem["tab"] | null {
  if (!isRecord(value)) return null;
  const { pluginId, tabId, params, threadId } = value;
  if (typeof pluginId !== "string" || typeof tabId !== "string") return null;
  if (threadId !== null && typeof threadId !== "string") return null;
  return {
    pluginId,
    tabId,
    params: isRecord(params) ? params : undefined,
    threadId,
  };
}

export function parseDragItem(raw: string): ExperimentalDragItem | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const { id, title, path, pluginId } = value;
  const kind = ITEM_KINDS.find((candidate) => candidate === value.kind);
  if (kind === undefined) return null;
  if (typeof id !== "string" || id === "" || typeof title !== "string") {
    return null;
  }
  const tab = value.tab === undefined ? undefined : parseDragTab(value.tab);
  if (tab === null) return null;
  return {
    kind,
    id,
    title,
    ...(typeof path === "string" ? { path } : {}),
    ...(typeof pluginId === "string" ? { pluginId } : {}),
    ...(tab === undefined ? {} : { tab }),
  };
}

export function hasItemDrag(dataTransfer: DataTransfer | null): boolean {
  return (
    dataTransfer !== null &&
    Array.from(dataTransfer.types).includes(ITEM_DRAG_TYPE)
  );
}

function clearCurrentDragItem(): void {
  currentDragItem = null;
}

export function writeDragItem(
  dataTransfer: DataTransfer,
  item: ExperimentalDragItem,
): void {
  const raw = JSON.stringify(item);
  const parsed = parseDragItem(raw);
  if (parsed === null) {
    throw new Error("experimental_writeDragItem: not a drag item");
  }
  dataTransfer.setData(ITEM_DRAG_TYPE, raw);
  currentDragItem = parsed;
  window.addEventListener("dragend", clearCurrentDragItem, {
    capture: true,
    once: true,
  });
}

export function readDragItem(
  dataTransfer: DataTransfer,
): ExperimentalDragItem | null {
  if (!hasItemDrag(dataTransfer)) return null;
  const raw = dataTransfer.getData(ITEM_DRAG_TYPE);
  return raw === "" ? currentDragItem : parseDragItem(raw);
}

export function panelTabDragItem(
  tab: { tab: FixedPanelTab; label: string; isPinned?: boolean },
  panelStateId: string | null,
): ExperimentalDragItem | null {
  if (tab.isPinned === true) return null;
  const target = panelTabActionTarget(tab.tab, panelStateId);
  if (target === null) return null;
  return {
    kind: "tab",
    id: tab.tab.id,
    title: tab.label,
    pluginId: target.pluginId,
    tab: {
      pluginId: target.pluginId,
      tabId: target.tabId,
      params: target.params,
      threadId: target.threadId,
    },
  };
}

export function sidePanelOf(element: Element): HTMLElement | null {
  let aside = element.closest<HTMLElement>("aside");
  while (aside !== null) {
    if (aside.querySelector(SIDE_PANEL_CHROME_SELECTOR) !== null) return aside;
    aside = aside.parentElement?.closest<HTMLElement>("aside") ?? null;
  }
  return null;
}

export type WorkbenchDropPlace =
  | { pane: 1 | 2; index: number; bar: Rect }
  | { pane: "new"; box: Rect };

export interface ItemDropZone {
  zone: ExperimentalItemDropTarget["zone"];
  element: HTMLElement;
  place?: WorkbenchDropPlace;
}

function paneTabGroups(panel: HTMLElement): HTMLElement[] {
  return Array.from(
    panel.querySelectorAll<HTMLElement>(PANE_TAB_GROUP_SELECTOR),
  )
    .filter((group) => sidePanelOf(group) === panel)
    .map((group) => ({ group, left: group.getBoundingClientRect().left }))
    .sort((a, b) => a.left - b.left)
    .map(({ group }) => group);
}

function insertionBar(group: DOMRect, pills: DOMRect[], index: number): Rect {
  const before = pills[index - 1];
  const after = pills[index];
  const x =
    before !== undefined && after !== undefined
      ? (before.right + after.left) / 2
      : after !== undefined
        ? after.left - INSERTION_BAR_WIDTH_PX
        : before !== undefined
          ? before.right + INSERTION_BAR_WIDTH_PX
          : group.left + INSERTION_BAR_WIDTH_PX;
  const reference = after ?? before ?? group;
  return {
    left: x - INSERTION_BAR_WIDTH_PX / 2,
    top: reference.top,
    width: INSERTION_BAR_WIDTH_PX,
    height: reference.height,
  };
}

export function workbenchDropPlace(
  panel: HTMLElement,
  element: Element,
  x: number,
  y: number,
): WorkbenchDropPlace | null {
  const groups = paneTabGroups(panel);
  if (groups.length === 0) return null;
  const chrome = element.closest(SIDE_PANEL_CHROME_SELECTOR);
  const group =
    chrome === null
      ? undefined
      : groups.find((candidate) => chrome.contains(candidate));
  if (group !== undefined) {
    const pane = groups.indexOf(group) + 1;
    if (pane !== 1 && pane !== 2) return null;
    const pills = Array.from(
      group.querySelectorAll<HTMLElement>(TAB_PILL_SELECTOR),
      (pill) => pill.getBoundingClientRect(),
    );
    const index = pills.filter((rect) => rect.left + rect.width / 2 < x).length;
    return {
      pane,
      index,
      bar: insertionBar(group.getBoundingClientRect(), pills, index),
    };
  }
  if (groups.length !== 1) return null;
  const rect = panel.getBoundingClientRect();
  if (pickZone(rect, x, y) !== "right") return null;
  return { pane: "new", box: zoneBox(rect, "right") };
}

export function resolveItemDropZone(
  target: EventTarget | null,
  point?: { x: number; y: number },
): ItemDropZone | null {
  const element =
    target instanceof Element
      ? target
      : target instanceof Node
        ? target.parentElement
        : null;
  if (element === null) return null;
  const composer = element.closest<HTMLElement>(COMPOSER_SELECTOR);
  if (composer !== null) return { zone: "composer", element: composer };
  const panel = sidePanelOf(element);
  if (panel !== null) {
    const place =
      point === undefined
        ? null
        : workbenchDropPlace(panel, element, point.x, point.y);
    return place === null
      ? { zone: "workbench", element: panel }
      : { zone: "workbench", element: panel, place };
  }
  const main = element.closest<HTMLElement>(MAIN_SELECTOR);
  return main === null ? null : { zone: "main", element: main };
}

export interface ItemDropPane {
  id: string;
  threadId: string | null;
  focused: boolean;
}

export function threadIdOfElement(
  element: Element,
  panes: readonly ItemDropPane[],
  routeThreadId: string | null,
): string | null {
  if (panes.length === 0) return routeThreadId;
  let holder = element.closest(`[${SPLIT_PANE_ATTRIBUTE}]`);
  while (holder !== null) {
    const paneId = holder.getAttribute(SPLIT_PANE_ATTRIBUTE);
    const pane = panes.find((candidate) => candidate.id === paneId);
    if (pane !== undefined) return pane.threadId;
    holder = holder.parentElement?.closest(`[${SPLIT_PANE_ATTRIBUTE}]`) ?? null;
  }
  const focused = panes.find((pane) => pane.focused);
  return focused === undefined ? routeThreadId : focused.threadId;
}

function composerBridgeOf(
  threadId: string | null,
): ComposerEditorBridge | undefined {
  return getComposerEditorBridges().find(({ host }) =>
    threadId === null
      ? host.scope.kind === "new-thread"
      : host.scope.kind === "thread" && host.scope.threadId === threadId,
  );
}

function insertComposerPart(
  threadId: string | null,
  pluginId: string,
  part: ComposerInsertPart,
): boolean {
  const bridge = composerBridgeOf(threadId);
  if (bridge === undefined) return false;
  const { handle } = createComposerHandleBinding(
    bridge.host.textEffectKey,
    detachedComposerController(pluginId, bridge.host, "itemDrop"),
  );
  try {
    handle.insert(part, { at: "cursor" });
    return true;
  } catch (error) {
    console.warn(`[plugin:${pluginId}] item drop mention failed`, error);
    return false;
  }
}

export function insertComposerMention(
  threadId: string | null,
  pluginId: string,
  mention: ExperimentalDropMention,
): boolean {
  if (mention.id === "" || mention.provider.trim() === "") return false;
  return insertComposerPart(threadId, pluginId, {
    provider: mention.provider,
    id: mention.id,
    label: mention.label,
  });
}

export function insertComposerThreadMention(
  threadId: string | null,
  pluginId: string,
  thread: { id: string; title: string; projectId?: string },
): boolean {
  if (thread.id === "") return false;
  return insertComposerPart(threadId, pluginId, {
    kind: "thread",
    threadId: thread.id,
    ...(thread.projectId === undefined ? {} : { projectId: thread.projectId }),
    label: thread.title.trim() || thread.id,
    from: 0,
    to: 0,
  });
}

export function insertComposerText(
  threadId: string | null,
  text: string,
): boolean {
  if (text === "") return false;
  const bridge = composerBridgeOf(threadId);
  if (bridge === undefined) return false;
  if (bridge.insertAtCursor({ text, mentions: [] }, false)) return true;
  const current = bridge.host.getCurrent();
  bridge.host.setDraft({ ...current, text: `${current.text}${text}` });
  return true;
}

export interface ItemDropEnvironment {
  handlers(): readonly PluginItemDropSlot[];
  threadIdOf(element: HTMLElement): string | null;
  insertText(threadId: string | null, text: string): boolean;
  insertMention(
    threadId: string | null,
    pluginId: string,
    mention: ExperimentalDropMention,
  ): boolean;
  insertThreadMention(
    threadId: string | null,
    pluginId: string,
    thread: { id: string; title: string },
  ): boolean;
}

function hasStrings<Key extends string>(
  value: unknown,
  keys: readonly Key[],
): value is Record<Key, string> {
  return isRecord(value) && keys.every((key) => typeof value[key] === "string");
}

export function itemDropTarget(
  zone: ItemDropZone,
  environment: ItemDropEnvironment,
  pluginId: string,
): ExperimentalItemDropTarget {
  if (zone.zone === "main") return { zone: "main" };
  const threadId = environment.threadIdOf(zone.element);
  if (zone.zone === "workbench") {
    const place = zone.place;
    if (place === undefined) return { zone: "workbench", threadId };
    return place.pane === "new"
      ? { zone: "workbench", threadId, pane: "new" }
      : { zone: "workbench", threadId, pane: place.pane, index: place.index };
  }
  return {
    zone: "composer",
    threadId,
    insertText: (text) =>
      typeof text === "string" && environment.insertText(threadId, text),
    insertMention: (mention: unknown) =>
      hasStrings(mention, ["provider", "id", "label"]) &&
      environment.insertMention(threadId, pluginId, {
        provider: mention.provider,
        id: mention.id,
        label: mention.label,
      }),
    insertThreadMention: (thread: unknown) =>
      hasStrings(thread, ["id", "title"]) &&
      environment.insertThreadMention(threadId, pluginId, {
        id: thread.id,
        title: thread.title,
      }),
  };
}

function inPluginOrder(
  handlers: readonly PluginItemDropSlot[],
): PluginItemDropSlot[] {
  return [...handlers].sort(
    (a, b) => a.pluginId.localeCompare(b.pluginId) || a.id.localeCompare(b.id),
  );
}

export interface ItemDropMatch {
  handler: PluginItemDropSlot;
  target: ExperimentalItemDropTarget;
}

export function findItemDropHandler(
  handlers: readonly PluginItemDropSlot[],
  item: ExperimentalDragItem,
  targetFor: (pluginId: string) => ExperimentalItemDropTarget,
): ItemDropMatch | null {
  for (const handler of inPluginOrder(handlers)) {
    try {
      const target = targetFor(handler.pluginId);
      if (handler.canDrop(item, target) === true) return { handler, target };
    } catch (error) {
      console.warn(
        `[plugin:${handler.pluginId}] item drop "${handler.id}" canDrop failed`,
        error,
      );
    }
  }
  return null;
}

export function runItemDrop(
  handler: PluginItemDropSlot,
  item: ExperimentalDragItem,
  target: ExperimentalItemDropTarget,
): void {
  const report = (error: unknown) =>
    console.warn(
      `[plugin:${handler.pluginId}] item drop "${handler.id}" failed`,
      error,
    );
  try {
    void Promise.resolve(handler.drop(item, target)).catch(report);
  } catch (error) {
    report(error);
  }
}

function createDropIndicator(doc: Document): HTMLElement {
  const indicator = doc.createElement("div");
  const label = doc.createElement("div");
  Object.assign(label.style, {
    position: "absolute",
    inset: "0",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "12px",
    fontWeight: "600",
    color: "var(--primary)",
  } satisfies Partial<CSSStyleDeclaration>);
  indicator.append(label);
  Object.assign(indicator.style, {
    position: "fixed",
    zIndex: "90",
    pointerEvents: "none",
  } satisfies Partial<CSSStyleDeclaration>);
  doc.body.append(indicator);
  return indicator;
}

function positionDropIndicator(
  indicator: HTMLElement,
  place: WorkbenchDropPlace,
): void {
  const box = place.pane === "new" ? place.box : place.bar;
  indicator.setAttribute(
    ITEM_DROP_INDICATOR_ATTRIBUTE,
    place.pane === "new" ? "edge" : "bar",
  );
  Object.assign(indicator.style, {
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    ...(place.pane === "new"
      ? {
          borderRadius: "12px",
          background: "color-mix(in oklab, var(--primary) 12%, transparent)",
          border:
            "2px solid color-mix(in oklab, var(--primary) 55%, transparent)",
        }
      : {
          borderRadius: "1px",
          background: "var(--primary)",
          border: "none",
        }),
  } satisfies Partial<CSSStyleDeclaration>);
  const label = indicator.firstElementChild;
  if (label !== null) {
    label.textContent = place.pane === "new" ? NEW_PANE_LABEL : "";
  }
}

export function installItemDropHost(
  doc: Document,
  environment: ItemDropEnvironment,
): () => void {
  let marked: HTMLElement | null = null;
  let outlined: HTMLElement | null = null;
  let indicator: HTMLElement | null = null;
  const mark = (zone: ItemDropZone | null) => {
    marked = zone?.element ?? null;
    const outline =
      zone === null || zone.place !== undefined ? null : zone.element;
    if (outlined !== outline) {
      outlined?.removeAttribute(ITEM_DROP_ATTRIBUTE);
      outline?.setAttribute(ITEM_DROP_ATTRIBUTE, "over");
      outlined = outline;
    }
    const place = zone?.place;
    if (place === undefined) {
      indicator?.remove();
      indicator = null;
      return;
    }
    indicator ??= createDropIndicator(doc);
    positionDropIndicator(indicator, place);
  };

  const onDragOver = (event: DragEvent) => {
    const dataTransfer = event.dataTransfer;
    if (!hasItemDrag(dataTransfer) || dataTransfer === null) return;
    const zone = event.defaultPrevented
      ? null
      : resolveItemDropZone(event.target, {
          x: event.clientX,
          y: event.clientY,
        });
    if (zone === null) return mark(null);
    const handlers = environment.handlers();
    const item = readDragItem(dataTransfer);
    const allowed =
      item === null
        ? handlers.length > 0
        : findItemDropHandler(handlers, item, (pluginId) =>
            itemDropTarget(zone, environment, pluginId),
          ) !== null;
    if (!allowed) return mark(null);
    event.preventDefault();
    dataTransfer.dropEffect = "copy";
    mark(zone);
  };

  const onDragLeave = (event: DragEvent) => {
    if (marked === null || !hasItemDrag(event.dataTransfer)) return;
    const entered =
      event.relatedTarget instanceof Node
        ? event.relatedTarget
        : (doc.elementFromPoint?.(event.clientX, event.clientY) ?? null);
    if (entered !== null && marked.contains(entered)) return;
    mark(null);
  };

  const onDrop = (event: DragEvent) => {
    const dataTransfer = event.dataTransfer;
    if (!hasItemDrag(dataTransfer) || dataTransfer === null) return;
    mark(null);
    const item = readDragItem(dataTransfer);
    currentDragItem = null;
    if (event.defaultPrevented || item === null) return;
    const zone = resolveItemDropZone(event.target, {
      x: event.clientX,
      y: event.clientY,
    });
    if (zone === null) return;
    const match = findItemDropHandler(
      environment.handlers(),
      item,
      (pluginId) => itemDropTarget(zone, environment, pluginId),
    );
    if (match === null) return;
    event.preventDefault();
    runItemDrop(match.handler, item, match.target);
  };

  const onDragEnd = () => {
    mark(null);
    currentDragItem = null;
  };

  doc.addEventListener("dragenter", onDragOver);
  doc.addEventListener("dragover", onDragOver);
  doc.addEventListener("dragleave", onDragLeave);
  doc.addEventListener("drop", onDrop);
  doc.addEventListener("dragend", onDragEnd);
  return () => {
    mark(null);
    doc.removeEventListener("dragenter", onDragOver);
    doc.removeEventListener("dragover", onDragOver);
    doc.removeEventListener("dragleave", onDragLeave);
    doc.removeEventListener("drop", onDrop);
    doc.removeEventListener("dragend", onDragEnd);
  };
}

export interface PointerItemDrag {
  move(x: number, y: number): void;
  end(x: number, y: number): boolean;
  cancel(): void;
}

const INERT_POINTER_ITEM_DRAG: PointerItemDrag = {
  move: () => {},
  end: () => false,
  cancel: () => {},
};

export function beginPointerItemDrag(
  doc: Document,
  item: ExperimentalDragItem,
  source: Element | null,
): PointerItemDrag {
  const view = doc.defaultView;
  if (
    view === null ||
    typeof view.DataTransfer !== "function" ||
    typeof view.DragEvent !== "function" ||
    typeof doc.elementsFromPoint !== "function"
  ) {
    return INERT_POINTER_ITEM_DRAG;
  }
  const dataTransfer = new view.DataTransfer();
  dataTransfer.setData(ITEM_DRAG_TYPE, JSON.stringify(item));
  currentDragItem = item;
  const appRoot = source?.closest("body > *") ?? null;
  let over: Element | null = null;
  let accepted = false;

  const elementAt = (x: number, y: number): Element | null => {
    const hit = doc
      .elementsFromPoint(x, y)
      .find((element) => appRoot === null || appRoot.contains(element));
    if (hit === undefined || source?.contains(hit) === true) return null;
    return hit;
  };
  const send = (
    type: string,
    target: Element,
    x: number,
    y: number,
    relatedTarget: Element | null,
  ): boolean =>
    target.dispatchEvent(
      new view.DragEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: x,
        clientY: y,
        dataTransfer,
        relatedTarget,
      }),
    );
  const moveTo = (x: number, y: number) => {
    const next = elementAt(x, y);
    if (next !== over) {
      if (over !== null) send("dragleave", over, x, y, next);
      if (next !== null) send("dragenter", next, x, y, over);
      over = next;
    }
    accepted = over !== null && !send("dragover", over, x, y, null);
  };
  const finish = (x: number, y: number) => {
    send("dragend", doc.body, x, y, null);
    over = null;
    accepted = false;
    currentDragItem = null;
  };

  return {
    move: moveTo,
    end(x, y) {
      moveTo(x, y);
      const dropped = over !== null && accepted;
      if (over !== null) send(dropped ? "drop" : "dragleave", over, x, y, null);
      finish(x, y);
      return dropped;
    },
    cancel() {
      if (over !== null) send("dragleave", over, 0, 0, null);
      finish(0, 0);
    },
  };
}
