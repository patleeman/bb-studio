import type Database from "better-sqlite3";
import { absorbedPluginIds } from "@bb-studio/kit/contract";
import type { ModuleServices } from "../modules/services";
import { officeAuthorsRpc } from "./contract";

export async function officeAuthors(db: Database.Database, modules?: ModuleServices) {
  const rows = modules?.has("bot-teams") ? officeAuthorsRpc.output.parse(await modules.call("bot-teams", "office_authors", {})) : [];
  const threads = new Map(rows.map(row => [row.threadId, row.botId]));
  const items = new Map<string, string>();
  const created = db.prepare("SELECT plugin_id,item_id,thread_id FROM item_threads WHERE role='created' ORDER BY created_at,thread_id").all() as { plugin_id: string; item_id: string; thread_id: string }[];
  for (const row of created) {
    const botId = threads.get(row.thread_id);
    if (!botId) continue;
    const pluginId = (absorbedPluginIds as readonly string[]).includes(row.plugin_id) ? "studio" : row.plugin_id;
    const key = `${pluginId}:${row.item_id}`;
    if (!items.has(key)) items.set(key, botId);
  }
  return { thread: (id: string) => threads.get(id) ?? null, item: (ref: { pluginId: string; id: string }) => items.get(`${ref.pluginId}:${ref.id}`) ?? null };
}
