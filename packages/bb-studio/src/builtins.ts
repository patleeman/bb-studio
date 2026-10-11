// Kinds built into Studio (docs/merging-add-ons.md). Each keeps the plugin id
// it had as its own add-on, so its items stay `<pluginId>:<id>` in Studio's
// tables, and its items open under Studio's one panel at
// /plugins/studio/studio/<segment>/<id>. The old add-on's own address still
// resolves, so saved tabs, links and bookmarks keep working.

export const STUDIO_ROOT = "/plugins/studio/studio";

/** Studio panel sub-path for conversations about items: chats/item/…, chats/choose/…, chats/quote/…. */
export const CHATS_PATH = "chats";
export const CHATS_ROOT = `${STUDIO_ROOT}/${CHATS_PATH}`;
/** Where conversations opened when Chat had its own panel; old links still resolve. */
const LEGACY_CHATS_ROOT = `/plugins/studio/${CHATS_PATH}`;

/** A path under the old Chat panel rewritten to its Studio address, or null. */
export function legacyChatPath(path: string): string | null {
  const rest = path.slice(LEGACY_CHATS_ROOT.length);
  if (!path.startsWith(LEGACY_CHATS_ROOT) || !/^(?:$|[/?#])/.test(rest)) return null;
  return `${CHATS_ROOT}${rest}`;
}

export interface BuiltinRoute {
  /** The item namespace: the add-on's old plugin id. */
  pluginId: string;
  /** Studio panel sub-path: /plugins/studio/studio/<segment>/<id>. */
  segment: string;
  /** The kind Studio's library filters to at /plugins/studio/studio/<segment>. */
  kind: string;
  /** The add-on's own item route before the merge, without a trailing slash. */
  legacyRoot: string;
  /** Sub-paths under the route that are pages of Studio's, not items (Talk's `unsent`). */
  pages?: readonly string[];
}

export const BUILTIN_ROUTES: readonly BuiltinRoute[] = [
  { pluginId: "pages", segment: "pages", kind: "page", legacyRoot: "/plugins/pages/pages" },
  { pluginId: "artifacts", segment: "artifacts", kind: "artifact", legacyRoot: "/plugins/artifacts/artifacts" },
  { pluginId: "excalidraw", segment: "drawings", kind: "drawing", legacyRoot: "/plugins/excalidraw/drawings" },
  { pluginId: "design", segment: "designs", kind: "design", legacyRoot: "/plugins/design/designs" },
  { pluginId: "talk", segment: "recordings", kind: "recording", legacyRoot: "/plugins/talk/recordings", pages: ["unsent"] },
];

export const BUILTIN_PLUGIN_IDS: ReadonlySet<string> = new Set(BUILTIN_ROUTES.map((route) => route.pluginId));

const decode = (segment: string) => {
  try { return decodeURIComponent(segment); } catch { return null; }
};

/**
 * The built-in item a path opens, from its Studio address or its old add-on
 * address, with the Studio address it now has. Sub-views after the id are
 * kept in `href` so a deep link still lands where it pointed.
 */
export function builtinItemAt(path: string): { route: BuiltinRoute; pluginId: string; id: string; href: string } | null {
  const clean = path.split(/[?#]/)[0]!.replace(/\/+$/, "");
  for (const route of BUILTIN_ROUTES) {
    for (const root of [`${STUDIO_ROOT}/${route.segment}`, route.legacyRoot]) {
      if (!clean.startsWith(`${root}/`)) continue;
      const [raw, ...rest] = clean.slice(root.length + 1).split("/");
      const id = raw ? decode(raw) : null;
      if (!id || route.pages?.includes(id)) return null;
      return { route, pluginId: route.pluginId, id, href: [`${STUDIO_ROOT}/${route.segment}`, encodeURIComponent(id), ...rest].join("/") };
    }
  }
  return null;
}

/** A path with an old add-on address rewritten to its Studio address; others unchanged. */
export function canonicalPath(path: string): string {
  const chat = legacyChatPath(path);
  if (chat) return chat;
  const found = builtinItemAt(path);
  if (!found) return path;
  const suffix = path.slice(path.split(/[?#]/)[0]!.length);
  return `${found.href}${suffix}`;
}

/** Whether a Studio sub-path (no leading slash) is a built-in kind's route. */
export function builtinSegment(subPath: string): { route: BuiltinRoute; rest: string } | null {
  const [segment, ...rest] = subPath.replace(/^\/+|\/+$/g, "").split("/");
  const route = BUILTIN_ROUTES.find((each) => each.segment === segment);
  return route ? { route, rest: rest.join("/") } : null;
}
