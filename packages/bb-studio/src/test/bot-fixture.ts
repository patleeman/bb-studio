// Two Bots for profile and avatar tests: the primary Dot (thr_main) and
// Scout (thr_scout); thr_child was started by Scout's thread.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach } from "vitest";
import { Bots, BOT_ID } from "../bot";
import { MIGRATIONS } from "../migrations";
import { PERSONAL_PROJECT_ID, ProjectLeads } from "../project-lead";

const dispose: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of dispose.splice(0)) await fn(); });

export async function twoBots() {
  const parents: Record<string, string> = { thr_child: "thr_scout" };
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: {
    threads: {
      get: (async ({ threadId }: { threadId: string }) => ({ id: threadId, parentThreadId: parents[threadId] ?? null })) as never,
      defaultExecutionOptions: (async () => ({ model: "model" })) as never,
    },
  } });
  dispose.push(() => harness.lifecycle.dispose());
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const leads = new ProjectLeads({ db, sdk: bb.sdk, changed: () => {}, personalPrompt: () => "", botPrompt: () => null });
  const bots = new Bots({ db, sdk: bb.sdk, leads, changed: () => {} });
  db.prepare("INSERT INTO project_leads VALUES (?, ?, 1, 2)").run(PERSONAL_PROJECT_ID, "thr_main");
  const insert = db.prepare("INSERT INTO bots (id, name, avatar, state, thread_id, heartbeat_was_on, created_at, updated_at) VALUES (?, ?, '🤖', 'active', ?, 0, ?, ?)");
  insert.run(BOT_ID, "Dot", "thr_main", 1, 1);
  insert.run("bot_scout", "Scout", "thr_scout", 2, 2);
  return { bb, harness, db, bots };
}
