// Where Studio apps' sidebar sections meet the sidebar that shows them.
//
// The sidebar's thread list is one plugin's slot (Studio Sidebar), so other
// plugins can't render into it. Instead each app registers its sections here;
// the host renders an empty element for each, above the threads and in the
// same scroll area, and publishes it here; the app portals its section into
// it. Every plugin bundles its own copy of the kit, so the registry lives on
// `window` under a versioned key and every copy uses the same shape.

export interface SidebarSectionInfo {
  /** `<plugin>:<id>` */
  key: string;
  pluginId: string;
  id: string;
  title: string;
  /** Default position; lower comes first. The user's own order wins. */
  order: number;
}

/** The user's arrangement: section keys in order, and the hidden ones. */
export interface SidebarLayout {
  order: string[];
  hidden: string[];
}

export interface SidebarHost {
  /** Called after a row navigates; closes the sidebar on phones. */
  navigate(): void;
}

interface Registry {
  sections: Map<string, SidebarSectionInfo>;
  anchors: Map<string, HTMLElement>;
  host: SidebarHost | null;
  /** Bumped on every change, as the snapshot hooks compare. */
  revision: number;
}

const REGISTRY_KEY = "__bbStudioSidebar_v1";
export const SIDEBAR_CHANGE_EVENT = "bb-studio-sidebar-change";
const LAYOUT_KEY = "bb:studio-sidebar:layout";
const COLLAPSED_KEY = "bb:studio-sidebar:collapsed";

export const sectionKey = (pluginId: string, id: string) => `${pluginId}:${id}`;

function registry(): Registry {
  const scope = window as unknown as Record<string, Registry | undefined>;
  scope[REGISTRY_KEY] ??= { sections: new Map(), anchors: new Map(), host: null, revision: 0 };
  return scope[REGISTRY_KEY];
}

function changed(): void {
  registry().revision += 1;
  window.dispatchEvent(new Event(SIDEBAR_CHANGE_EVENT));
}

export function revision(): number {
  return registry().revision;
}

/** Calls `listener` on any change here, or to the layout in another window. */
export function subscribe(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== LAYOUT_KEY && event.key !== COLLAPSED_KEY) return;
    registry().revision += 1;
    listener();
  };
  window.addEventListener(SIDEBAR_CHANGE_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(SIDEBAR_CHANGE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function registerSection(info: Omit<SidebarSectionInfo, "key">): () => void {
  const key = sectionKey(info.pluginId, info.id);
  const entry = { ...info, key };
  registry().sections.set(key, entry);
  changed();
  return () => {
    if (registry().sections.get(key) !== entry) return;
    registry().sections.delete(key);
    changed();
  };
}

export function publishAnchor(key: string, element: HTMLElement | null): void {
  const anchors = registry().anchors;
  if ((anchors.get(key) ?? null) === element) return;
  if (element) anchors.set(key, element);
  else anchors.delete(key);
  changed();
}

export function anchorFor(key: string): HTMLElement | null {
  return registry().anchors.get(key) ?? null;
}

export function setHost(host: SidebarHost | null): void {
  registry().host = host;
  changed();
}

export function host(): SidebarHost | null {
  return registry().host;
}

function readJson<T>(key: string, parse: (value: unknown) => T): T {
  try {
    return parse(JSON.parse(localStorage.getItem(key) ?? "null"));
  } catch {
    return parse(null);
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
  changed();
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((each): each is string => typeof each === "string") : [];

export function readLayout(): SidebarLayout {
  return readJson(LAYOUT_KEY, (value) => {
    const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    return { order: strings(record.order), hidden: strings(record.hidden) };
  });
}

/**
 * Sections by default order, then the slots of the ones the user placed are
 * refilled in the user's order. So the user's order holds, and a newly
 * installed app's section still lands where its default order puts it.
 */
export function arrange(sections: readonly SidebarSectionInfo[], layout: SidebarLayout): { visible: SidebarSectionInfo[]; hidden: SidebarSectionInfo[] } {
  const placed = new Map(layout.order.map((key, index) => [key, index]));
  const sorted = [...sections].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title) || a.key.localeCompare(b.key));
  const inUserOrder = sorted.filter((each) => placed.has(each.key)).sort((a, b) => placed.get(a.key)! - placed.get(b.key)!);
  let next = 0;
  for (let index = 0; index < sorted.length; index++) {
    if (placed.has(sorted[index]!.key)) sorted[index] = inUserOrder[next++]!;
  }
  const hidden = new Set(layout.hidden);
  return { visible: sorted.filter((each) => !hidden.has(each.key)), hidden: sorted.filter((each) => hidden.has(each.key)) };
}

export function sections(): { visible: SidebarSectionInfo[]; hidden: SidebarSectionInfo[] } {
  return arrange([...registry().sections.values()], readLayout());
}

export function setSectionHidden(key: string, hide: boolean): void {
  const layout = readLayout();
  const hidden = layout.hidden.filter((each) => each !== key);
  writeJson(LAYOUT_KEY, { ...layout, hidden: hide ? [...hidden, key] : hidden });
}

/** Moves a section among the visible ones; the result becomes the saved order. */
export function moveSection(key: string, delta: -1 | 1): void {
  const layout = readLayout();
  const order = sections().visible.map((each) => each.key);
  const from = order.indexOf(key);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= order.length) return;
  [order[from], order[to]] = [order[to]!, order[from]!];
  // Keep the places of sections that aren't loaded right now.
  const rest = layout.order.filter((each) => !order.includes(each));
  writeJson(LAYOUT_KEY, { ...layout, order: [...order, ...rest] });
}

export function canMove(key: string, delta: -1 | 1): boolean {
  const order = sections().visible.map((each) => each.key);
  const from = order.indexOf(key);
  return from >= 0 && from + delta >= 0 && from + delta < order.length;
}

export function isCollapsed(key: string): boolean {
  return readJson(COLLAPSED_KEY, strings).includes(key);
}

export function setCollapsed(key: string, collapse: boolean): void {
  const current = readJson(COLLAPSED_KEY, strings).filter((each) => each !== key);
  writeJson(COLLAPSED_KEY, collapse ? [...current, key] : current);
}
