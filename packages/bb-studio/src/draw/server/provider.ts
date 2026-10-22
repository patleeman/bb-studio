// Drawings as a Studio kind: the same `studio_*` provider methods an add-on
// publishes over RPC, called in-process by Studio's hub (src/hub.ts).
import { copyTitle, eachId, fillTemplate, fillTemplateJson, type StudioItem, type StudioKind } from "../../kit/contract";
import { mustGet as requireItem, storeActions, storeSearch, type StudioProviderHandlers } from "../../kit/server/index";
import { getNonDeletedElements, parseSceneData } from "../merge";
import { DRAW_ICON, PLUGIN_ID, drawingHref, thumbnailUrl } from "../shared";
import type { DrawingRow, DrawingStore } from "./store";
import { sceneExport, sceneThumbnail } from "./thumbnail";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// resvg's WebAssembly build: BB installs plugins without optional dependencies,
// which drops resvg-js's per-platform native bindings. It loads on the first
// PNG export, not when Studio starts.
let resvg: Promise<typeof import("@resvg/resvg-wasm")> | undefined;
const loadResvg = () =>
  (resvg ??= import("@resvg/resvg-wasm").then(async (module) => {
    await module.initWasm(await readFile(createRequire(import.meta.url).resolve("@resvg/resvg-wasm/index_bg.wasm")));
    return module;
  }).catch((error: unknown) => { resvg = undefined; throw error; }));

/**
 * resvg-wasm can't see system fonts, so without these every PNG export drops
 * its text. Excalidraw's package ships its own fonts as WOFF2, which resvg reads.
 * Family names match those the thumbnail SVG asks for (see thumbnail.ts).
 */
const EXPORT_FONT_DIRS = ["Liberation", "Cascadia", "Virgil", "Excalifont"];
const EXPORT_FONT_OPTIONS = { loadSystemFonts: false, defaultFontFamily: "Liberation Sans", sansSerifFamily: "Liberation Sans", monospaceFamily: "Cascadia Code", cursiveFamily: "Excalifont" };
let exportFonts: Promise<Uint8Array[]> | undefined;
const loadExportFonts = () => {
  if (exportFonts) return exportFonts;
  // Resolves to <package>/dist/prod/index.js; the fonts sit beside it.
  const root = join(dirname(createRequire(import.meta.url).resolve("@excalidraw/excalidraw")), "fonts");
  exportFonts = (async () => {
    const files = (await Promise.all(EXPORT_FONT_DIRS.map(async (dir) => {
      const directory = join(root, dir);
      const fonts = (await readdir(directory)).filter((name) => name.endsWith(".woff2"));
      if (!fonts.length) throw new Error(`No .woff2 export fonts found in ${directory}`);
      return fonts.map((name) => join(directory, name));
    }))).flat();
    return Promise.all(files.map(async (file) => new Uint8Array(await readFile(file))));
  })().catch((error: unknown) => {
    exportFonts = undefined;
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not load Excalidraw export fonts under ${root}: ${reason}`, { cause: error });
  });
  return exportFonts;
};

export const DRAWING_KIND: StudioKind = {
  id: "drawing",
  label: "Drawing",
  plural: "Drawings",
  icon: DRAW_ICON,
  columns: [{ id: "elements", label: "Elements" }],
  actions: [{ id: "copy-text", label: "Copy text", icon: "Copy", result: "copy" }],
  create: { mode: "rpc" },
  canArchive: true,
  capabilities: { create: true, move: true, archive: true, delete: true, rename: true, duplicate: true, export: true, comments: false, versions: false, links: false, templates: true },
  mentionProviderId: "drawing",

  blurb: "Diagrams and sketches.",
  agentHint: "Read it with excalidraw_get_drawing and change it with excalidraw_update_drawing.",
};

const PREVIEW_CHARS = 140;

/** The words written on a drawing, top to bottom. */
export function drawingText(data: string): string[] {
  const elements = getNonDeletedElements(parseSceneData(data));
  return elements
    .filter((element) => element.type === "text" && typeof element.text === "string" && element.text.trim())
    .sort((a, b) => Number(a.y ?? 0) - Number(b.y ?? 0) || Number(a.x ?? 0) - Number(b.x ?? 0))
    .map((element) => (element.text as string).trim());
}

type Summary = { count: number; preview: string | null; thumbnail: boolean };
type SummaryCache = Map<string, { at: number; summary: Summary }>;
const SUMMARY_CACHE_ENTRIES = 10_000;

/** Element count and text preview, cached per revision: scenes can be large. */
function summarize(row: DrawingRow, summaries: SummaryCache): Summary {
  const cached = summaries.get(row.id);
  if (cached?.at === row.updated_at) {
    summaries.delete(row.id);
    summaries.set(row.id, cached);
    return cached.summary;
  }
  const scene = parseSceneData(row.data);
  const count = getNonDeletedElements(scene).length;
  const text = drawingText(row.data).join(" · ").replace(/\s+/g, " ");
  const summary = {
    count,
    preview: text ? (text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS - 1).trimEnd()}…` : text) : null,
    // Some elements (embeds, empty text) draw nothing; the route would 404.
    thumbnail: count > 0 && sceneThumbnail(scene) !== null,
  };
  summaries.delete(row.id);
  summaries.set(row.id, { at: row.updated_at, summary });
  if (summaries.size > SUMMARY_CACHE_ENTRIES) summaries.delete(summaries.keys().next().value!);
  return summary;
}

function makeStudioItem(row: DrawingRow, summaries: SummaryCache): StudioItem {
  const { count, preview, thumbnail } = summarize(row, summaries);
  return {
    id: row.id,
    kind: DRAWING_KIND.id,
    title: row.name.trim(),
    icon: null,
    projectId: row.project_id,
    parentId: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by === "user" || row.updated_by === "agent" ? row.updated_by : null,
    preview,
    facts: [{ id: "elements", value: count.toLocaleString("en-US"), sort: count }],
    badge: null,
    thumbnailUrl: thumbnail ? thumbnailUrl(row.id, row.updated_at) : null,
    href: drawingHref(row.id),
    archived: row.archived_at !== null,
    template: Boolean(row.template),
  };
}

export function toStudioItem(row: DrawingRow): StudioItem {
  return makeStudioItem(row, new Map());
}

/** Studio lists at most this many; past it, Studio keeps tags of items it didn't see. */
const LIST_LIMIT = 10_000;

export function drawingProvider(deps: { store: DrawingStore; changed(id: string): void }): StudioProviderHandlers {
  const { store } = deps;
  const summaries: SummaryCache = new Map();
  const item = (row: DrawingRow) => makeStudioItem(row, summaries);
  const mustGet = (id: string) => requireItem((key) => store.get(key), id, "Drawing not found.");
  const duplicate = (id: string, projectId: string | null, variables?: Record<string, string>) => {
    const source = mustGet(id);
    const data = variables ? fillTemplateJson(source.data, variables) : source.data;
    const row = store.create({ name: variables ? fillTemplate(source.name, variables) : copyTitle(source.name), projectId, by: "app" });
    store.write(row.id, data, "app");
    deps.changed(row.id);
    return item(store.get(row.id)!);
  };

  return {
    // No panel of its own: the kind's collection is Studio's library filtered to it.
    studio_describe: () => ({ pluginId: PLUGIN_ID, version: 2, panel: null, kinds: [DRAWING_KIND] }),
    studio_get: ({ ids }) => ({ items: ids.flatMap((id) => { const row = store.get(id); return row ? [item(row)] : []; }) }),
    studio_read: ({ id }) => ({ content: store.get(id) ? drawingText(store.get(id)!.data).join("\n") : null }),
    studio_list: () => {
      const rows = store.list({ includeArchived: true, limit: LIST_LIMIT });
      return { items: rows.map(item), truncated: rows.length === LIST_LIMIT };
    },
    studio_create: ({ kind, projectId }) => {
      if (kind !== DRAWING_KIND.id) throw new Error(`Unknown kind "${kind}".`);
      const row = store.create({ name: "", projectId, by: "app" });
      deps.changed(row.id);
      return { item: item(row) };
    },
    studio_rename: ({ id, title }) =>
      eachId([id], () => {
        mustGet(id);
        store.rename(id, title, "app");
        deps.changed(id);
      }),
    studio_duplicate: ({ id, projectId }) => ({ item: duplicate(id, projectId) }),
    studio_template: ({ id, template }) => { mustGet(id); store.setTemplate(id, template); deps.changed(id); return { item: item(mustGet(id)) }; },
    studio_instantiate: ({ id, projectId, variables }) => { if (!mustGet(id).template) throw new Error("Drawing is not a template."); return { item: duplicate(id, projectId, variables) }; },
    studio_export: async ({ id, format }) => {
      const row = mustGet(id);
      if (format === "svg" || format === "png") {
        const svg = sceneExport(parseSceneData(row.data));
        const bytes = format === "png"
          ? new (await loadResvg()).Resvg(svg, { font: { fontBuffers: await loadExportFonts(), ...EXPORT_FONT_OPTIONS } }).render().asPng()
          : Buffer.from(svg);
        return { files: [{ name: `${row.name.trim() || "Untitled drawing"}.${format}`, mime: format === "png" ? "image/png" : "image/svg+xml", data: Buffer.from(bytes).toString("base64") }] };
      }
      if (format !== "excalidraw") throw new Error(`Unsupported drawing format: ${format}`);
      return { files: [{ name: `${row.name.trim() || "Untitled drawing"}.excalidraw`, mime: "application/json", data: Buffer.from(row.data).toString("base64") }] };
    },
    studio_action: ({ action, ids }) => {
      if (action !== "copy-text") throw new Error(`Unknown action "${action}".`);
      const parts = ids.map((id) => {
        const row = mustGet(id);
        const text = drawingText(row.data).join("\n\n");
        return ids.length === 1 ? text : `## ${row.name.trim() || "Untitled drawing"}\n\n${text || "(No text.)"}`;
      });
      const text = parts.join("\n\n");
      if (!text.trim()) return { message: "There's no text on this drawing.", text: null };
      return { message: ids.length === 1 ? "Text copied" : `Copied text from ${ids.length} drawings`, text };
    },
    ...storeActions({
      move: (id: string, projectId: string | null) => {
        mustGet(id);
        store.setProject(id, projectId);
        deps.changed(id);
      },
      archive: (id: string, archived: boolean) => {
        mustGet(id);
        store.setArchived(id, archived);
        deps.changed(id);
      },
      delete: (id: string) => {
        mustGet(id);
        store.delete(id);
        summaries.delete(id);
        deps.changed(id);
      },
    }),
    studio_search: storeSearch({
      find: (query) => store.list({ limit: 10_000 })
        .map((row) => ({ id: row.id, text: drawingText(row.data).join("\n") }))
        .filter((row) => row.text.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 200),
      text: (row) => row.text,
    }),
  };
}
