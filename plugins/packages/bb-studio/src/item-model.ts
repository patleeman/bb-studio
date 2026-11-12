// Studio's item model: two kinds of thing, each with types (README "Pages and
// Apps").
// - Pages are documents: a doc, a design (UI screens or a slide deck), a
//   whiteboard.
// - Apps are things that run: a mini app, a dashboard, an artifact.
// Recordings, VS Code workspaces and add-ons' kinds belong to neither.
//
// An item keeps the id and the namespace (`pluginId`) it always had, and the
// `kind` its provider gives it; `family` and `type` are what Studio adds. The
// `items` table (src/item-index.ts) holds one row per item with both.
// Pure: the server, the app and tests share it.

export type ItemFamily = "page" | "app";
export type ItemType = "doc" | "design" | "whiteboard" | "mini" | "dashboard" | "artifact";

export interface ItemTypeInfo {
  type: ItemType;
  family: ItemFamily;
  /** The item namespace: the plugin id the type had as its own add-on. */
  pluginId: string;
  /** The kind id the type's provider reports, and the name older filters, tabs and cards use. */
  kind: string;
  /** The type's own route segment: /plugins/studio/studio/<segment>/<id>. */
  segment: string;
  label: string;
  plural: string;
  /** Whether an id is one of this type's. */
  isId(id: string): boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every type, pages first. The id patterns are each provider's own (their shared.ts). */
export const ITEM_TYPES: readonly ItemTypeInfo[] = [
  { type: "doc", family: "page", pluginId: "pages", kind: "page", segment: "pages", label: "Page", plural: "Pages", isId: (id) => /^pg_[\w-]+$/.test(id) },
  { type: "whiteboard", family: "page", pluginId: "excalidraw", kind: "drawing", segment: "drawings", label: "Whiteboard", plural: "Whiteboards", isId: (id) => UUID.test(id) || /^drw_[0-9a-f]{16}$/.test(id) },
  { type: "design", family: "page", pluginId: "design", kind: "design", segment: "designs", label: "Design", plural: "Designs", isId: (id) => /^dsn_[0-9a-f]{16}$/.test(id) },
  { type: "mini", family: "app", pluginId: "minis", kind: "mini", segment: "minis", label: "App", plural: "Apps", isId: (id) => /^mini_[0-9a-f]{16}$/.test(id) },
  { type: "dashboard", family: "app", pluginId: "dashboards", kind: "dashboard", segment: "dashboards", label: "Dashboard", plural: "Dashboards", isId: (id) => /^dsh_[0-9a-f]{16}$/.test(id) },
  { type: "artifact", family: "app", pluginId: "artifacts", kind: "artifact", segment: "artifacts", label: "Artifact", plural: "Artifacts", isId: (id) => /^art_[0-9a-z]{16}$/.test(id) },
];

export const ITEM_FAMILIES: readonly { id: ItemFamily; label: string; plural: string; segment: string; types: readonly ItemType[] }[] = [
  { id: "page", label: "Page", plural: "Pages", segment: "pages", types: ITEM_TYPES.filter((each) => each.family === "page").map((each) => each.type) },
  { id: "app", label: "App", plural: "Apps", segment: "apps", types: ITEM_TYPES.filter((each) => each.family === "app").map((each) => each.type) },
];

export const isItemFamily = (value: unknown): value is ItemFamily => value === "page" || value === "app";
export const isItemType = (value: unknown): value is ItemType => ITEM_TYPES.some((each) => each.type === value);

export function itemType(type: string): ItemTypeInfo | null {
  return ITEM_TYPES.find((each) => each.type === type) ?? null;
}

/** The type of a provider's kind: `("design", "design")` is a design. Null for kinds outside the two families. */
export function typeOfKind(pluginId: string, kind: string): ItemTypeInfo | null {
  return ITEM_TYPES.find((each) => each.pluginId === pluginId && each.kind === kind) ?? null;
}

/** The type a name means: a type ("doc"), or the kind name it had before ("page", "drawing"). */
export function typeNamed(name: string): ItemTypeInfo | null {
  const value = name.trim().toLowerCase();
  return ITEM_TYPES.find((each) => each.type === value) ?? ITEM_TYPES.find((each) => each.kind === value) ?? null;
}

/** The family a name means: "page", "pages", "app" or "apps". */
export function familyNamed(name: string): ItemFamily | null {
  const value = name.trim().toLowerCase();
  return ITEM_FAMILIES.find((each) => each.id === value || each.segment === value)?.id ?? null;
}

/** The type an id belongs to, from its prefix (`pg_`, `dsn_`, `drw_` or a UUID, `mini_`, `dsh_`, `art_`). */
export function typeOfId(id: string): ItemTypeInfo | null {
  return ITEM_TYPES.find((each) => each.isId(id)) ?? null;
}

/** The family and type Studio reports beside an item's `kind`; empty for kinds outside the two families. */
export function familyAndType(pluginId: string, kind: string): { family: ItemFamily; type: ItemType } | Record<string, never> {
  const info = typeOfKind(pluginId, kind);
  return info ? { family: info.family, type: info.type } : {};
}

/**
 * Kind names for a search or a list, with family and type names spelled out
 * as the kinds providers report: "apps" is mini, dashboard and artifact,
 * "pages" is page, drawing and design, "doc" is page, "whiteboard" is
 * drawing. "page" stays the one kind it always named, and other names pass
 * through.
 */
export function kindsNamed(names: readonly string[]): string[] {
  return [...new Set(names.flatMap((name) => {
    const value = name.trim().toLowerCase();
    const family = value === "page" ? null : familyNamed(value);
    if (family) return ITEM_TYPES.filter((each) => each.family === family).map((each) => each.kind);
    return [ITEM_TYPES.find((each) => each.type === value)?.kind ?? name];
  }))];
}

const STUDIO_ROOT = "/plugins/studio/studio";

/** An item's family address: /plugins/studio/studio/pages/<id> for any page type, …/apps/<id> for any app type. */
export function familyHref(family: ItemFamily, id: string): string {
  return `${STUDIO_ROOT}/${family === "page" ? "pages" : "apps"}/${encodeURIComponent(id)}`;
}

/** A type's own address, the one items carry as `href`. */
export function typeHref(info: ItemTypeInfo, id: string): string {
  return `${STUDIO_ROOT}/${info.segment}/${encodeURIComponent(id)}`;
}
