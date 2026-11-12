// BB Studio Visual Chat (prototype; plugin id "studio-visual-chat", formerly
// "studio-canvas" and before that "canvas"):
// its own plugin, off unless installed. An agent talks
// on a board it edits each turn, backed by a hidden BB thread in the
// personal project (src/server.ts). Studio is required (its hands-free
// voice calls canvas.voice / canvas.voiceRun to edit the board while it
// talks), but this plugin reads nothing of Studio's.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { importLegacyCanvases, legacyDatabasePaths } from "./src/legacy-import";
import { CANVAS_MIGRATIONS } from "./src/migrations";
import { CANVAS_TOOL_SEARCH_ENV } from "./src/instructions";
import { CANVAS_KEY_SETTINGS, exaKey } from "./src/settings";
import { CANVAS_TOOLS, registerCanvas } from "./src/server";

export default function plugin(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, CANVAS_MIGRATIONS);
  // Canvases made under the old plugin ids ("studio-canvas", else "canvas"), copied in once, read-only.
  try {
    const result = importLegacyCanvases(db, legacyDatabasePaths(bb.server.experimental_dataDir));
    if (result.status === "imported") bb.log.info(`Imported the old plugin's canvases from ${result.source}: ${JSON.stringify(result.counts)}`);
  } catch (error) {
    bb.log.warn(`Could not import the old plugin's canvases: ${error instanceof Error ? error.message : String(error)}`);
  }
  // The Exa API key for canvas_image and canvas_images (a BB secret: Settings → Plugins → BB Studio Visual Chat). Read
  // when a picture is looked up, never logged or sent anywhere but Exa. Without it, queries go to Wikipedia.
  const keys = bb.settings.define(CANVAS_KEY_SETTINGS);
  const canvas = registerCanvas(bb, db, { images: { exaKey: async () => exaKey(await keys.get()) } });
  // Claude Code defers every plugin tool unless ENABLE_TOOL_SEARCH says otherwise: on a canvas thread (only), it
  // runs tool search in threshold mode, so the canvas tools load up front and a turn skips the ToolSearch round.
  // The resolver has five seconds; a thread being made right now is waited for briefly.
  bb.providers.experimental_contributeEnv("claude-code", async ({ threadId }) => (threadId && (await canvas.isCanvasThreadSoon(threadId, 3000)) ? [{ ...CANVAS_TOOL_SEARCH_ENV }] : []));
  // A canvas's hidden thread gets the canvas tools, rules and skill; other
  // threads get nothing from this plugin. pluginMetadata is this plugin's own.
  bb.agents.configure((context) => canvas.isCanvasThread(context.thread.id, context.pluginMetadata)
    ? { tools: [...CANVAS_TOOLS], skills: ["canvas"], instructions: canvas.instructionsFor(context.thread.id, context.pluginMetadata, context.provider?.id) }
    : { tools: [], skills: [], instructions: "" });
}
