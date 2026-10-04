/** Item IDs are opaque. Only URL path segments are URI-decoded. */
export interface StudioReference { pluginId: string; id: string }
export interface ReferenceProvider {
  pluginId: string;
  kinds: readonly { mentionProviderId?: string | null }[];
}
export interface ReferenceRoute {
  pluginId: string;
  /** Registered path before the encoded item ID, including its trailing slash. */
  path: string;
  /** Explicit suffix patterns after the item ID; :id matches one path segment. */
  subpaths?: readonly string[];
}
export interface ReferenceOptions {
  providers?: readonly ReferenceProvider[];
  routes?: readonly ReferenceRoute[];
  /** Absolute URLs are accepted only when this origin is known and matches. */
  origin?: string;
}

const LEGACY_NAMESPACES: Record<string, readonly string[]> = {
  pages: ["page"], excalidraw: ["drawing"], artifacts: ["artifact"], talk: ["recordings"],
  "studio-tables": ["table"], "bot-teams": ["bot", "views"],
};
export const STUDIO_REFERENCE_ROUTES: readonly ReferenceRoute[] = [
  { pluginId: "pages", path: "/plugins/pages/pages/" },
  { pluginId: "excalidraw", path: "/plugins/excalidraw/drawings/" },
  { pluginId: "artifacts", path: "/plugins/artifacts/artifacts/" },
  { pluginId: "talk", path: "/plugins/talk/recordings/" },
  { pluginId: "studio-tables", path: "/plugins/studio-tables/tables/", subpaths: ["view/:id", "row/:id", "view/:id/row/:id"] },
  { pluginId: "bot-teams", path: "/plugins/bot-teams/bots/", subpaths: ["profile"] },
  { pluginId: "bot-teams", path: "/plugins/bot-teams/channels/" },
];
const validPlugin = (id: string) => /^[a-z0-9-]+$/.test(id);

export function parseStudioItemReference(value: string): StudioReference | null {
  const match = /^item:([a-z0-9-]+):([\s\S]+)$/.exec(value);
  return match ? { pluginId: match[1]!, id: match[2]! } : null;
}

export function parseStudioMentionReference(pluginId: string, itemId: string, providers: readonly ReferenceProvider[] = []): StudioReference | null {
  if (!validPlugin(pluginId) || !itemId) return null;
  if (pluginId === "studio-chat") return parseStudioItemReference(itemId);
  const namespaces = [...(LEGACY_NAMESPACES[pluginId] ?? []), ...providers.filter((provider) => provider.pluginId === pluginId).flatMap((provider) => provider.kinds.flatMap((kind) => kind.mentionProviderId ? [kind.mentionProviderId] : []))];
  const prefix = namespaces.sort((a, b) => b.length - a.length).find((namespace) => itemId.startsWith(`${namespace}:`));
  const id = prefix ? itemId.slice(prefix.length + 1) : itemId;
  return id ? { pluginId, id } : null;
}

export function parseStudioItemHref(href: string, options: ReferenceOptions = {}): StudioReference | null {
  if (/[\\\u0000-\u0020]/.test(href)) return null;
  let path: string;
  if (href.startsWith("/plugins/")) path = href.split(/[?#]/, 1)[0]!;
  else {
    if (!options.origin) return null;
    try {
      const origin = new URL(options.origin).origin;
      const url = new URL(href, origin);
      if (!/^https?:$/.test(url.protocol) || url.origin !== origin || url.username || url.password) return null;
      // A relative non-root path must not masquerade as a plugin route.
      if (!/^(?:https?:)?\/\//.test(href)) return null;
      path = url.pathname;
    } catch { return null; }
  }
  for (const route of [...STUDIO_REFERENCE_ROUTES, ...(options.routes ?? [])]) {
    if (!validPlugin(route.pluginId) || !route.path.startsWith(`/plugins/${route.pluginId}/`) || !route.path.endsWith("/") || !path.startsWith(route.path)) continue;
    try {
      const [id, ...suffix] = path.slice(route.path.length).split("/").map(decodeURIComponent);
      if (!id || id === "." || id === ".." || suffix.some((part) => !part || part === "." || part === "..")) continue;
      if (suffix.length && !route.subpaths?.some((pattern) => {
        const parts = pattern.split("/");
        return parts.length === suffix.length && parts.every((part, index) => part === ":id" || part === suffix[index]);
      })) continue;
      return { pluginId: route.pluginId, id };
    } catch { return null; }
  }
  return null;
}

/** Reads explicit item tokens and known route links, never a URL's inner path. */
export function studioTextReferences(text: string, options: ReferenceOptions = {}): { ref: StudioReference; kind: "mention" | "link" }[] {
  const found: { ref: StudioReference; kind: "mention" | "link" }[] = [];
  const tokens = /\]\(([^\s)]+)(?:\s+"[^"]*")?\)|<([^<>\s]+)>|(?<![\w/:])(?:[a-z][a-z0-9+.-]*:\/\/|\/\/|\/plugins\/|item:)[^\s<>\[\]()"'`]+/gi;
  for (const match of text.matchAll(tokens)) {
    const target = match[1] ?? match[2] ?? match[0];
    const mention = parseStudioItemReference(target);
    const ref = mention ?? parseStudioItemHref(target, options);
    if (ref) found.push({ ref, kind: mention ? "mention" : "link" });
  }
  return found;
}
