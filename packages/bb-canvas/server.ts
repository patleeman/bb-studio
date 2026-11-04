// Canvas (prototype): its own plugin, off unless installed. An agent talks
// on a board it edits each turn, backed by a hidden BB thread in the
// personal project (src/server.ts). Studio is required (its hands-free
// voice calls canvas.voice / canvas.voiceRun to edit the board while it
// talks), but this plugin reads nothing of Studio's.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { CANVAS_MIGRATIONS } from "./src/migrations";
import { CANVAS_TOOLS, registerCanvas } from "./src/server";

export default function plugin(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, CANVAS_MIGRATIONS);
  const canvas = registerCanvas(bb, db);
  // A canvas's hidden thread gets the canvas tools, rules and skill; other
  // threads get nothing from this plugin. pluginMetadata is this plugin's own.
  bb.agents.configure((context) => canvas.isCanvasThread(context.thread.id, context.pluginMetadata)
    ? { tools: [...CANVAS_TOOLS], skills: ["canvas"], instructions: canvas.instructions }
    : { tools: [], skills: [], instructions: "" });
}
