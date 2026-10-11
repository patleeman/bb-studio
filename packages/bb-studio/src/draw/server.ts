// Drawings, built into Studio: sketch Excalidraw drawings with your agents.
//
// Drawings live in Studio's SQLite database as serialized Excalidraw scenes
// (src/draw/server/store.ts). The app edits them with the real
// @excalidraw/excalidraw component, loaded only when a drawing opens, and
// autosaves through the `drawings.*` RPCs. Agents read and edit the live
// scene with the excalidraw_* tools; writes from either side go through the
// same element-level merge, so both survive.
//
// This was the Draw plugin (id `excalidraw`). Its items keep that id as their
// namespace, its agent tools, skill, mention provider, message directive,
// thread tab and composer entry keep their names, and the plugin's last
// release is an upgrade bridge that copies its rows here (see `bridge` below
// and docs/merging-add-ons.md).
import { studioSchemas } from "@bb-studio/kit/contract";
import { errorMessage } from "@bb-studio/kit/format";
import { createChangeBus, defineItemMention, readThreadFile, resolveSource, serveBytes, studioServices, threadRoots, type BackupHandlers, type StudioProviderHandlers } from "@bb-studio/kit/server";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { z } from "zod";
import { bridgeContract, rpcContract } from "./contract";
import {
  applyElementUpserts,
  elementCount,
  getNonDeletedElements,
  mergeFullScene,
  parseSceneData,
  serializeSceneData,
  type SceneElement,
  type StoredScene,
} from "./merge";
import { createDrawBackup } from "./server/backup";
import { mentionContext as buildMentionContext } from "./server/mention";
import { drawingProvider } from "./server/provider";
import { DrawingStore, displayName, toMeta, type DrawingRow, type Writer } from "./server/store";
import { sceneThumbnail } from "./server/thumbnail";
import { DRAWING_UPDATE_TYPE, PICKER_ID, PLUGIN_ID, REALTIME_CHANNEL, ROUTE_SEGMENT, drawingHref } from "./shared";

const MAX_TOOL_SCENE_CHARS = 400_000;

export const DRAWINGS_USAGE = [
  "usage: bb studio drawings <command>",
  "  list                                  List drawings",
  "  create <name>                         Create a drawing",
  "  show <id> [--raw]                     Print a drawing's scene JSON (deleted elements left out unless --raw)",
  "  rename <id> <new-name>                Rename a drawing",
  "  delete <id>                           Delete a drawing",
  "  merge <id> <scene-file.json>          Upsert elements from a JSON file (an elements array or a full scene)",
  "  remove-elements <id> <element-id…>    Delete elements by id",
].join("\n");

export interface BuiltinDrawings {
  store: DrawingStore;
  /** Studio's provider methods, which the hub calls in-process. */
  provider: StudioProviderHandlers;
  /** Its section of a Studio backup, still named `excalidraw`. */
  backup: BackupHandlers;
  /** `bb studio drawings …` */
  cli(argv: string[], ctx: { threadId?: string | null; projectId?: string | null; cwd?: string | null }): Promise<{ exitCode: number; stdout?: string; stderr?: string }>;
  dispose(): void;
}

/** Registers drawings' RPC, HTTP route, agent tools and mention provider on Studio. Studio has run the migrations. */
export function registerDraw(bb: BbPluginApi, db: Database.Database): BuiltinDrawings {
  const store = new DrawingStore(db);
  const services = studioServices(bb.sdk);

  // In a thread, the file is on the thread's host, inside its workspace or
  // thread storage; from a terminal with no thread, it's a local file.
  async function readSceneFile(filePath: string, ctx: { threadId?: string | null; cwd?: string | null }): Promise<string> {
    if (!ctx.threadId) {
      const { readFile } = await import("node:fs/promises");
      const { resolve } = await import("node:path");
      return readFile(resolve(ctx.cwd ?? process.cwd(), filePath), "utf8");
    }
    const { roots } = await threadRoots(bb, ctx.threadId);
    const source = resolveSource(filePath, roots, ctx.cwd);
    if ("error" in source) throw new Error(source.error);
    return Buffer.from((await readThreadFile(bb, source)).bytes).toString("utf8");
  }
  /** A drawing an agent made is linked to its thread. */
  const created = (id: string, threadId: string) => void services.created({ pluginId: PLUGIN_ID, id }, threadId).catch(() => {});
  /** A drawing an agent changed belongs to its thread too, so the thread's tab lists it. */
  const edited = (id: string, threadId: string) => {
    const at = Date.now();
    void services.linkThread({ threadId, ref: { pluginId: PLUGIN_ID, id }, role: "edited", state: "working", createdAt: at, updatedAt: at, metadata: {} }).catch(() => {});
  };
  /** The reply card that opens the drawing in the user's workbench. */
  const card = (id: string) => `Put this line on its own in your reply so the user can open the drawing beside the chat:\n::drawing{id="${id}"}`;

  const studio = studioSchemas(z);
  // Agents write drawings a few elements at a time; Studio only needs to hear about it now and then.
  const changeBus = createChangeBus({ bb, channel: REALTIME_CHANNEL, pluginId: PLUGIN_ID, schemas: studio, event: (id, updatedAt, by) => ({ type: DRAWING_UPDATE_TYPE, drawingId: id, updatedAt, by }), delayMs: 1500 });

  /** Tells open editors, galleries, and Studio that a drawing changed. Drawings keep no versions. */
  function changed(id: string, updatedAt: number, by: Writer | "studio") {
    changeBus.changed(id, updatedAt, by);
  }

  function mustGet(id: string): DrawingRow {
    const row = store.get(id);
    if (!row) throw new Error(`Drawing ${id} not found`);
    return row;
  }

  function create(name: string, by: Writer, projectId: string | null = null): DrawingRow {
    const row = store.create({ name, projectId, by });
    changed(row.id, row.updated_at, by);
    return row;
  }

  /** Writes a scene and notifies. Returns the new revision. */
  function write(row: DrawingRow, scene: StoredScene, by: Writer, options: { name?: string } = {}): number {
    const updatedAt = store.write(row.id, serializeSceneData(scene), by, options);
    changed(row.id, updatedAt, by);
    return updatedAt;
  }

  function remove(id: string, by: Writer) {
    if (store.delete(id)) changed(id, Date.now(), by);
  }

  /** What an `@drawing` mention gives the agent. */
  function mention(id: string): string {
    const row = store.get(id);
    if (!row) throw new Error(`Excalidraw drawing ${id} not found`);
    return buildMentionContext({ ...row, name: displayName(row) });
  }

  /** Human-readable one-line summary of a scene (agent tool results). */
  function sceneSummary(scene: StoredScene | null, fallback = "empty drawing"): string {
    const elements = getNonDeletedElements(scene);
    if (!elements.length) return fallback;
    const byType = new Map<string, number>();
    for (const el of elements) {
      const t = typeof el.type === "string" ? el.type : "unknown";
      byType.set(t, (byType.get(t) ?? 0) + 1);
    }
    const parts = [...byType.entries()].map(([t, n]) => `${n} ${t}${n > 1 ? "s" : ""}`);
    return `${elements.length} element(s): ${parts.join(", ")}`;
  }

  /** Image files without their data: what an agent needs to reference them. */
  function fileSummaries(files: Record<string, unknown> | undefined) {
    return Object.fromEntries(Object.entries(files ?? {}).map(([id, file]) => {
      const f = (file && typeof file === "object" ? file : {}) as { mimeType?: unknown; dataURL?: unknown };
      return [id, { id, mimeType: typeof f.mimeType === "string" ? f.mimeType : null, dataURLChars: typeof f.dataURL === "string" ? f.dataURL.length : 0 }];
    }));
  }

  bb.rpc.register(rpcContract, {
    "drawings.getDrawingMeta"({ id }) {
      const row = store.get(id);
      return { drawing: row ? toMeta(row) : null };
    },
    "drawings.listDrawings"() {
      return { drawings: store.list().map(toMeta) };
    },
    "drawings.createDrawing"({ name, projectId }) {
      return { drawing: toMeta(create(name, "app", projectId ?? null)) };
    },
    "drawings.getDrawing"({ id }) {
      const row = store.get(id);
      if (!row) return { drawing: null };
      return { drawing: { id: row.id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at, projectId: row.project_id, data: row.data } };
    },
    /** Cheap per-drawing revision check for the editor's polling fallback. */
    "drawings.getDrawingUpdatedAt"({ id }) {
      return { updatedAt: store.get(id)?.updated_at ?? 0 };
    },
    "drawings.saveDrawing"({ id, name, data, expectedUpdatedAt }) {
      return db.transaction(() => {
        const row = mustGet(id);
        if (expectedUpdatedAt !== undefined && row.updated_at !== expectedUpdatedAt)
          throw new Error("The drawing changed on the server. Save this draft as a copy to keep both versions.");
        // Multi-writer merge: element-level union, higher `version` wins,
        // tombstones preserved — so concurrent user edits and agent writes
        // both survive instead of last-writer-wins clobbering.
        const updatedAt = write(row, mergeFullScene(row.data, data), "editor", { name });
        return { ok: true, updatedAt };
      })();
    },
    "drawings.recoverDrawingCopy"({ sourceDrawingId, draftId, draftToken, name, data, projectId }) {
      const scene = parseSceneData(data);
      if (!scene) throw new Error("This recovery draft is not a valid drawing scene.");
      const source = store.get(sourceDrawingId);
      const { row, created: isNew } = store.recoverCopy({
        key: JSON.stringify([sourceDrawingId, draftId, draftToken]),
        name, data: serializeSceneData(scene), projectId: source ? source.project_id : projectId,
      });
      // Notify only after the transaction has committed a complete scene.
      if (isNew) changed(row.id, row.updated_at, "editor");
      return { drawing: toMeta(row) };
    },
    "drawings.renameDrawing"({ id, name }) {
      mustGet(id);
      const updatedAt = store.rename(id, name, "editor");
      changed(id, updatedAt, "editor");
      return { ok: true, updatedAt };
    },
    "drawings.deleteDrawing"({ id }) {
      remove(id, "app");
      return { ok: true };
    },
    async "drawings.attachDrawingImage"({ threadId, drawingId, pngBase64 }) {
      const row = mustGet(drawingId);
      const bytes = new Uint8Array(Buffer.from(pngBase64, "base64"));
      if (!bytes.length) throw new Error("Empty image payload");
      const thread = await bb.sdk.threads.get({ threadId });
      const slug = row.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "drawing";
      await bb.sdk.projects.attachments.upload({
        projectId: thread.projectId,
        clientFile: bytes,
        filename: `${slug}-${row.id.slice(0, 8)}.png`,
        mimeType: "image/png",
      });
      return { ok: true };
    },
    async "drawings.pickDrawing"({ threadId }) {
      const result = await bb.ui.requestInput({
        threadId,
        rendererId: PICKER_ID,
        title: "Attach a drawing",
        payload: { drawings: store.list().map(toMeta) },
        timeoutMs: 300_000,
      });
      if (result.outcome === "cancelled") return { drawingId: null };
      const value = result.value as { drawingId?: string };
      return { drawingId: value?.drawingId ?? null };
    },
  });

  bb.rpc.register(bridgeContract, {
    "drawings.importRows"({ drawings }) {
      const imported: string[] = [];
      const existing: string[] = [];
      const skipped: { id: string; reason: string }[] = [];
      for (const item of drawings) {
        const result = store.importDrawing(item);
        if (result.outcome === "imported") imported.push(item.id);
        else if (result.outcome === "existing") existing.push(item.id);
        else if (result.outcome === "skipped") skipped.push({ id: item.id, reason: result.reason });
      }
      for (const id of imported) changed(id, store.get(id)?.updated_at ?? Date.now(), "studio");
      return { imported, existing, skipped };
    },
    "drawings.mentionContext": ({ id }) => ({ context: mention(id) }),
    "drawings.thumbnail"({ id }) {
      const row = store.get(id);
      return { svg: row ? sceneThumbnail(parseSceneData(row.data)) : null };
    },
  });

  // Thumbnails for Studio's cards. The URL carries the revision, so a
  // response never goes stale.
  bb.http.route("GET", `/${ROUTE_SEGMENT}/thumbnail`, (context) => {
    const row = store.get(context.req.query("drawing") ?? "");
    const svg = row ? sceneThumbnail(parseSceneData(row.data)) : null;
    if (!svg) return context.text("Not found", 404);
    return serveBytes(svg, {
      "content-type": "image/svg+xml; charset=utf-8",
      // The SVG is built from scene data; never let it run anything.
      "content-security-policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'",
    });
  });

  // ---------------------------------------------------------------------
  // Agent tools — the "multiplayer" path: while the user has a drawing open,
  // the agent reads the live scene (excalidraw_get_drawing), edits it
  // (excalidraw_update_drawing), and the open editor applies the change live
  // (realtime + polling sync). Writes go through the same element-level merge
  // as editor autosaves, so both writers' edits survive.
  // ---------------------------------------------------------------------

  const excalidrawElementSchema = z.object({ id: z.string().min(1), type: z.string().min(1) }).passthrough();

  bb.agents.registerTool({
    name: "excalidraw_list_drawings",
    description:
      "List Excalidraw drawings in the user's bb workspace (id, name, element count, last updated). Use when the user asks you to work with or edit an Excalidraw drawing.",
    parameters: z.object({}),
    execute() {
      const rows = store.list();
      if (!rows.length) return "No Excalidraw drawings yet. Use excalidraw_create_drawing to make one.";
      const lines = rows.map((r) => {
        const m = toMeta(r);
        return `- ${displayName(r)} (id ${m.id}) — ${m.elementCount} element(s), updated ${new Date(m.updatedAt).toISOString()}, link ${drawingHref(m.id)}`;
      });
      return `Excalidraw drawings:\n${lines.join("\n")}`;
    },
  });

  bb.agents.registerTool({
    name: "excalidraw_get_drawing",
    description:
      "Read the current scene of an Excalidraw drawing: element JSON, appState, a text summary, and each image file's id, mimeType and size (image data is left out; `bb studio drawings show <id>` prints it). Always call this immediately before editing so you see the user's latest changes. To edit, use excalidraw_update_drawing.",
    parameters: z.object({ drawingId: z.string().min(1) }),
    execute({ drawingId }) {
      const row = store.get(drawingId);
      if (!row) return { content: [{ type: "text", text: `Drawing ${drawingId} not found.` }], isError: true };
      const scene = parseSceneData(row.data);
      const clean = getNonDeletedElements(scene);
      const payload = {
        drawing: { id: row.id, name: displayName(row), elementCount: clean.length, updatedAt: row.updated_at, summary: sceneSummary(scene, "empty drawing") },
        scene: {
          type: "excalidraw",
          version: 2,
          elements: clean,
          appState: scene?.appState ?? {},
          // Image data URLs would push most drawings with an image past the
          // inline limit, hiding the elements; list the files instead.
          files: fileSummaries(scene?.files),
        },
      };
      const json = JSON.stringify(payload, null, 2);
      if (json.length > MAX_TOOL_SCENE_CHARS) {
        const ids = clean.map((el) => (typeof el.id === "string" ? el.id : "?")).join(", ");
        return [
          `Drawing "${displayName(row)}" (id ${row.id}) has ${clean.length} element(s); scene JSON is ${json.length} bytes — too large to inline.`,
          sceneSummary(scene, "empty drawing"),
          `Element ids (in z-order):\n${ids}`,
          `To edit, pass element ids in excalidraw_update_drawing. Raw scene: bb studio drawings show ${row.id}`,
        ].join("\n\n");
      }
      return json;
    },
  });

  bb.agents.registerTool({
    name: "excalidraw_create_drawing",
    description: "Create a new empty Excalidraw drawing and return its id, name, and link. The user can open it from Studio.",
    parameters: z.object({ name: z.string().min(1).max(200) }),
    execute({ name }, ctx) {
      const row = create(name, "agent", ctx.projectId ?? null);
      created(row.id, ctx.threadId);
      return `Created Excalidraw drawing "${name}" (id ${row.id}). Link: [${name.replace(/[[\]]/g, "")}](${drawingHref(row.id)})\n${card(row.id)}`;
    },
  });

  bb.agents.registerTool({
    name: "excalidraw_update_drawing",
    description:
      "Edit an Excalidraw drawing the user may have open right now: upsert elements and/or delete elements by id. The user's open editor updates live. Merge is element-level: only the elements you send change, and any element you send wins (its version is bumped) unless it was already deleted (re-add it with a new id), so concurrent user edits to other elements are preserved. Fetch the latest scene with excalidraw_get_drawing first. Element objects must match Excalidraw's shape (id, type, x, y, width, height, strokeColor, backgroundColor, fillStyle, strokeWidth, roughness, opacity, seed, groupIds, frameId, roundness, ...) — safest to copy an existing element from excalidraw_get_drawing and change id/type/position/text. Upserting an existing id merges into it, so {id, type, x, y} moves an element and keeps the rest. `index` (z-order) is assigned automatically when omitted. deletedElementIds removes elements for the user, not just hides them.",
    parameters: z.object({
      drawingId: z.string().min(1),
      elements: z.array(excalidrawElementSchema).max(500).optional(),
      deletedElementIds: z.array(z.string()).max(500).optional(),
      appState: z.record(z.string(), z.unknown()).optional(),
      files: z.record(z.string(), z.unknown()).optional(),
    }),
    execute({ drawingId, elements, deletedElementIds, appState, files }, ctx) {
      const row = store.get(drawingId);
      if (!row) return { content: [{ type: "text", text: `Drawing ${drawingId} not found.` }], isError: true };
      if ((!elements || elements.length === 0) && (!deletedElementIds || deletedElementIds.length === 0)) {
        return { content: [{ type: "text", text: "Nothing to do: provide elements and/or deletedElementIds." }], isError: true };
      }
      const skipped: string[] = [];
      const merged = applyElementUpserts(row.data, (elements ?? []) as SceneElement[], { deletedElementIds, appState, files, skipped });
      const updatedAt = write(row, merged, "agent");
      if (ctx.threadId) edited(row.id, ctx.threadId);
      const clean = getNonDeletedElements(merged);
      return [
        `Updated drawing "${displayName(row)}" (id ${row.id}) — now ${clean.length} element(s): ${sceneSummary(merged)}.`,
        `- upserted ${(elements?.length ?? 0) - skipped.length} element(s), deleted ${deletedElementIds?.length ?? 0} element(s)`,
        ...(skipped.length ? [`- NOT applied: ${skipped.join(", ")} — already deleted in the drawing. Use new ids to add them again.`] : []),
        `- saved at ${new Date(updatedAt).toISOString()}`,
        `The user's open editor has been notified and shows the change live.`,
        card(row.id),
      ].join("\n");
    },
  });

  // Make the excalidraw tools available in every agent session.
  bb.agents.configure(() => ({
    tools: ["excalidraw_list_drawings", "excalidraw_get_drawing", "excalidraw_create_drawing", "excalidraw_update_drawing"],
    skills: [],
  }));

  // `@drawing` in any composer: at send time the agent receives its scene as context.
  bb.ui.registerMentionProvider(defineItemMention({
    id: "drawing",
    label: "Drawings",
    search({ query }) {
      const q = query.trim().toLowerCase();
      return store
        .list({ limit: 50 })
        .filter((r) => !q || displayName(r).toLowerCase().includes(q))
        .map((r) => ({ id: r.id, title: displayName(r), subtitle: `${toMeta(r).elementCount} elements` }));
    },
    resolve: (itemId) => ({ context: mention(itemId) }),
  }));

  // CLI: `bb studio drawings …`. A plugin registers one CLI command, and
  // Studio's is `studio`, so `bb excalidraw …` went with the old plugin.
  async function cli(argv: string[], ctx: { threadId?: string | null; projectId?: string | null; cwd?: string | null }): Promise<{ exitCode: number; stdout?: string; stderr?: string }> {
    const [cmd, ...rest] = argv;
    const notFound = (id: string) => ({ exitCode: 1, stderr: `Drawing ${id} not found\n` });
    switch (cmd) {
      case "list": {
        const rows = store.list();
        if (!rows.length) return { exitCode: 0, stdout: "No drawings yet.\n" };
        const lines = rows.map((r) => {
          const meta = toMeta(r);
          return `${meta.id}\t${displayName(r)}\t${meta.elementCount} elements\t${new Date(meta.updatedAt).toISOString()}`;
        });
        return { exitCode: 0, stdout: `${lines.join("\n")}\n` };
      }
      case "create": {
        const name = rest.join(" ");
        if (!name) return { exitCode: 1, stderr: "usage: bb studio drawings create <name>\n" };
        const row = create(name, "cli", ctx.projectId ?? null);
        if (ctx.threadId) created(row.id, ctx.threadId);
        return { exitCode: 0, stdout: `${row.id}\t${name}\n` };
      }
      case "show": {
        const [id, flag] = rest;
        if (!id) return { exitCode: 1, stderr: "usage: bb studio drawings show <id> [--raw]\n" };
        const row = store.get(id);
        if (!row) return notFound(id);
        // Default view filters tombstones (deleted elements) so agents and
        // humans reason about the live drawing; --raw dumps everything.
        const scene = parseSceneData(row.data);
        const out = flag === "--raw"
          ? row.data
          : serializeSceneData({ elements: getNonDeletedElements(scene), appState: scene?.appState ?? {}, files: scene?.files ?? {} });
        return { exitCode: 0, stdout: out.length > 900_000 ? `${out.slice(0, 900_000)}\n…(truncated)\n` : `${out}\n` };
      }
      case "rename": {
        const [id, ...nameParts] = rest;
        const name = nameParts.join(" ");
        if (!id || !name) return { exitCode: 1, stderr: "usage: bb studio drawings rename <id> <new-name>\n" };
        if (!store.get(id)) return notFound(id);
        changed(id, store.rename(id, name, "cli"), "cli");
        return { exitCode: 0, stdout: `renamed ${id} → ${name}\n` };
      }
      case "delete": {
        const id = rest[0];
        if (!id) return { exitCode: 1, stderr: "usage: bb studio drawings delete <id>\n" };
        if (!store.get(id)) return notFound(id);
        remove(id, "cli");
        return { exitCode: 0, stdout: `deleted ${id}\n` };
      }
      case "merge": {
        const [id, filePath, ...extra] = rest;
        if (!id || !filePath || extra.length) return { exitCode: 1, stderr: "usage: bb studio drawings merge <id> <scene-file.json>\n" };
        const row = store.get(id);
        if (!row) return notFound(id);
        let parsed: unknown;
        try {
          parsed = JSON.parse(await readSceneFile(filePath, ctx));
        } catch (error) {
          return { exitCode: 1, stderr: `cannot read/parse ${filePath}: ${errorMessage(error)}\n` };
        }
        const incoming = Array.isArray(parsed) ? parsed : (parsed as { elements?: unknown[] })?.elements ?? [];
        const upserts = incoming.filter((el): el is SceneElement => !!el && typeof el === "object" && typeof (el as SceneElement).id === "string");
        // A full scene's image elements need its files, or they merge as broken images.
        const files = Array.isArray(parsed) ? undefined : (parsed as { files?: Record<string, unknown> })?.files;
        const merged = applyElementUpserts(row.data, upserts, { files: files && typeof files === "object" ? files : undefined });
        const updatedAt = write(row, merged, "cli");
        return { exitCode: 0, stdout: `merged ${upserts.length} element(s) into ${id}; now ${elementCount(merged)} element(s); updatedAt ${updatedAt}\n` };
      }
      case "remove-elements": {
        const [id, ...elementIds] = rest;
        if (!id || elementIds.length === 0) return { exitCode: 1, stderr: "usage: bb studio drawings remove-elements <id> <element-id> [<element-id>…]\n" };
        const row = store.get(id);
        if (!row) return notFound(id);
        const merged = applyElementUpserts(row.data, [], { deletedElementIds: elementIds });
        const updatedAt = write(row, merged, "cli");
        return { exitCode: 0, stdout: `deleted ${elementIds.length} element(s) from ${id}; now ${elementCount(merged)} element(s); updatedAt ${updatedAt}\n` };
      }
      default:
        return { exitCode: 1, stderr: `${DRAWINGS_USAGE}\n` };
    }
  }

  return {
    store,
    provider: drawingProvider({ store, changed: (id) => changed(id, store.get(id)?.updated_at ?? Date.now(), "studio") }),
    backup: createDrawBackup({ db, store, changed: (id, updatedAt) => changed(id, updatedAt, "studio") }),
    cli,
    dispose: () => changeBus.dispose(),
  };
}
