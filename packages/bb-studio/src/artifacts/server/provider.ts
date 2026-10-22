// Artifacts as a Studio kind: the same `studio_*` provider methods an add-on
// publishes over RPC, called in-process by Studio's hub (src/hub.ts).
import { copyTitle, eachId, type StudioItem, type StudioKind } from "../../kit/contract";
import { mustGet as requireItem, storeSearch, type StudioProviderHandlers } from "../../kit/server/index";
import { ARTIFACT_ICON, PLUGIN_ID, TYPE_LABELS, artifactHref, contentUrl, formatBytes, isTextType } from "../shared";
import { displayTitle, versionType, type ArtifactStore, type ArtifactWithVersion } from "./store";

export const ARTIFACT_KIND: StudioKind = {
  id: "artifact",
  label: "Artifact",
  plural: "Artifacts",
  icon: ARTIFACT_ICON,
  columns: [
    { id: "type", label: "Type" },
    { id: "size", label: "Size" },
    { id: "versions", label: "Versions" },
  ],
  actions: [{ id: "copy-text", label: "Copy text", icon: "Copy", result: "copy" }],
  // Artifacts come from threads: agents save them, or you do from a reply.
  create: null,
  canArchive: true,
  capabilities: { create: false, move: true, archive: true, delete: true, rename: true, duplicate: true, export: true, comments: false, versions: true, links: true },
  mentionProviderId: "artifact",

  blurb: "Files your agents made.",
  agentHint: "Read it with artifacts_read.",
};

const PREVIEW_CHARS = 140;
/** Text past this isn't searched or previewed. */
export const TEXT_SCAN_BYTES = 1024 * 1024;

/** How much text the cache keeps, in characters; the least recently read goes first. */
const TEXT_CACHE_CHARS = 32 * 1024 * 1024;
const TEXT_CACHE_ENTRIES = 10_000;

type TextCache = { entries: Map<string, string | null>; chars: number };
const texts = new WeakMap<ArtifactStore, TextCache>();

/** Drop a store's cached versions when its artifacts are deleted. */
export function clearArtifactTextCache(store: ArtifactStore): void {
  texts.delete(store);
}

/** A version's text, for text types under the scan limit. Cached by version. */
export function artifactText(store: ArtifactStore, artifact: ArtifactWithVersion): string | null {
  let cache = texts.get(store);
  if (!cache) {
    cache = { entries: new Map(), chars: 0 };
    texts.set(store, cache);
  }
  const { version } = artifact;
  if (cache.entries.has(version.id)) {
    const text = cache.entries.get(version.id)!;
    cache.entries.delete(version.id);
    cache.entries.set(version.id, text);
    return text;
  }
  let text: string | null = null;
  if (isTextType(versionType(version)) && version.size <= TEXT_SCAN_BYTES) {
    text = store.bytes(version.sha256)?.toString("utf8") ?? null;
  }
  cache.entries.set(version.id, text);
  cache.chars += text?.length ?? 0;
  while (cache.entries.size > TEXT_CACHE_ENTRIES || cache.chars > TEXT_CACHE_CHARS) {
    const oldest = cache.entries.entries().next().value as [string, string | null] | undefined;
    if (!oldest) break;
    cache.entries.delete(oldest[0]);
    cache.chars -= oldest[1]?.length ?? 0;
  }
  return text;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };

/** The words of an HTML document: no scripts, styles or tags. */
export function htmlText(html: string): string {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, name: string) => ENTITIES[name]!);
}

/** What search matches and excerpts: the text, with HTML reduced to its words. */
function searchText(store: ArtifactStore, artifact: ArtifactWithVersion): string | null {
  const text = artifactText(store, artifact);
  return text && versionType(artifact.version) === "html" ? htmlText(text) : text;
}

function preview(store: ArtifactStore, artifact: ArtifactWithVersion): string | null {
  const source = artifact.description.trim() || firstLine(artifactText(store, artifact), displayTitle(artifact));
  if (!source) return null;
  const line = source.replace(/\s+/g, " ").trim();
  return line.length > PREVIEW_CHARS ? `${line.slice(0, PREVIEW_CHARS - 1).trimEnd()}…` : line;
}

/** The first line with words in it that doesn't just repeat the title. */
function firstLine(text: string | null, title: string): string | null {
  if (!text) return null;
  for (const line of text.split("\n")) {
    // Skip markup-only lines like "<!doctype html>" or "---".
    const clean = line.replace(/<[^>]*>/g, "").replace(/^[#>*\-\s`]+/, "").trim();
    if (clean && clean.toLowerCase() !== title.trim().toLowerCase()) return clean;
  }
  return null;
}

export function toStudioItem(store: ArtifactStore, artifact: ArtifactWithVersion): StudioItem {
  const { version } = artifact;
  const type = versionType(version);
  return {
    id: artifact.id,
    kind: ARTIFACT_KIND.id,
    title: displayTitle(artifact),
    icon: null,
    projectId: artifact.project_id,
    parentId: null,
    createdAt: artifact.created_at,
    updatedAt: artifact.updated_at,
    updatedBy: artifact.updated_by === "user" || artifact.updated_by === "agent" ? artifact.updated_by : null,
    preview: preview(store, artifact),
    facts: [
      { id: "type", value: TYPE_LABELS[type], sort: null },
      { id: "size", value: formatBytes(version.size), sort: version.size },
      { id: "versions", value: String(artifact.versions), sort: artifact.versions },
    ],
    badge: null,
    thumbnailUrl: type === "image" ? contentUrl(artifact.id, version.id) : null,
    href: artifactHref(artifact.id),
    archived: artifact.archived_at !== null,
  };
}

/** Studio lists at most this many; past it, Studio keeps tags of items it didn't see. */
const LIST_LIMIT = 10_000;

export function artifactProvider(deps: { store: ArtifactStore; changed(id: string): void }): StudioProviderHandlers {
  const { store } = deps;
  const mustGet = (id: string) => requireItem((key) => store.get(key), id, "Artifact not found.");
  const unsupported = () => { throw new Error("Artifacts don't support this operation."); };
  const each = (action: (id: string) => void) => ({ ids }: { ids: string[] }) => eachId(ids, action);

  return {
    // No panel of its own: the kind's collection is Studio's library filtered to it.
    studio_describe: () => ({ pluginId: PLUGIN_ID, version: 2, panel: null, kinds: [ARTIFACT_KIND] }),
    studio_get: ({ ids }) => ({ items: ids.flatMap((id) => { const row = store.get(id); return row ? [toStudioItem(store, row)] : []; }) }),
    studio_read: ({ id, format }) => { const row = store.get(id); const content = row ? artifactText(store, row) : null; return { content: content && format === "text" && versionType(row!.version) === "html" ? htmlText(content) : content }; },
    studio_list: () => {
      const rows = store.list({ includeArchived: true, limit: LIST_LIMIT });
      return { items: rows.map((a) => toStudioItem(store, a)), truncated: rows.length === LIST_LIMIT };
    },
    studio_create: () => {
      throw new Error("Artifacts are saved from threads, not created in Studio.");
    },
    studio_rename: ({ id, title }) =>
      eachId([id], () => {
        store.update(id, { title }, "app");
        deps.changed(id);
      }),
    studio_duplicate: ({ id, projectId }) => {
      const source = mustGet(id);
      const bytes = store.bytes(source.version.sha256);
      if (!bytes) throw new Error("Artifact content is missing.");
      const result = store.save({ name: source.version.name, mime: source.version.mime, bytes, title: copyTitle(source.title || source.version.name), description: source.description, projectId, by: "app" });
      deps.changed(result.artifact.id);
      return { item: toStudioItem(store, result.artifact) };
    },
    studio_export: ({ id, format }) => {
      if (format !== "original") throw new Error(`Unsupported artifact format: ${format}`);
      const source = mustGet(id);
      const bytes = store.bytes(source.version.sha256);
      if (!bytes) throw new Error("Artifact content is missing.");
      return { files: [{ name: source.version.name, mime: source.version.mime, data: bytes.toString("base64") }] };
    },
    studio_action: ({ action, ids }) => {
      if (action !== "copy-text") throw new Error(`Unknown action "${action}".`);
      const parts = ids.flatMap((id) => {
        const artifact = mustGet(id);
        const text = artifactText(store, artifact);
        if (text === null) return [];
        return [ids.length === 1 ? text : `## ${displayTitle(artifact)}\n\n${text}`];
      });
      if (!parts.length) return { message: ids.length === 1 ? "This artifact isn't text." : "None of these are text.", text: null };
      return { message: parts.length === 1 ? "Text copied" : `Copied text from ${parts.length} artifacts`, text: parts.join("\n\n") };
    },
    studio_template: unsupported,
    studio_instantiate: unsupported,
    studio_move: ({ ids, projectId }) => eachId(ids, (id) => {
      mustGet(id);
      store.setProject(id, projectId);
      deps.changed(id);
    }),
    studio_archive: ({ ids, archived }) => eachId(ids, (id) => {
      mustGet(id);
      store.setArchived(id, archived);
      deps.changed(id);
    }),
    studio_delete: each((id) => {
      mustGet(id);
      store.delete(id);
      clearArtifactTextCache(store);
      deps.changed(id);
    }),
    studio_search: storeSearch<ArtifactWithVersion>({
    find: (query) => {
      const needle = query.toLowerCase();
      return store.list({ limit: 10_000 })
        .filter((artifact) =>
          artifact.description.toLowerCase().includes(needle) ||
          artifact.version.name.toLowerCase().includes(needle) ||
          (searchText(store, artifact)?.toLowerCase().includes(needle) ?? false))
        .slice(0, 200);
    },
    text: (artifact) => [artifact.description, searchText(store, artifact)].filter(Boolean).join("\n"),
    }),
  };
}
