// Export a thread to a JSONL file before BB deletes it, on a BB that asks
// plugins first (the BB Studio fork's `experimental_beforeThreadDelete`).
// With the setting on, a deletion waits for the file; when the file cannot
// be written the hook throws and BB refuses the deletion. It covers every
// deletion: by hand, by Storage retention, or by an agent.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { exportThread } from "./thread-export";

interface BeforeDeleteHooks {
  experimental_beforeThreadDelete?: (handler: (context: { threadId: string }) => Promise<void>) => void;
}

export interface ThreadExportSettings {
  enabled: boolean;
  folder: string;
}

/** Runs the export for one deletion; throws to stop it. */
export async function exportBeforeDelete(bb: BbPluginApi, settings: ThreadExportSettings, threadId: string, now: number): Promise<void> {
  if (!settings.enabled) return;
  const folder = settings.folder.trim();
  if (folder === "") throw new Error("Export deleted threads is on, but no export folder is set (Settings, Studio, Threads).");
  await exportThread(bb, { threadId, directory: folder, now });
}

/** Registers the hook. Returns whether BB took it. */
export function registerThreadExportHook(bb: BbPluginApi, settings: () => ThreadExportSettings): boolean {
  const hooks = (bb as { experimental_hooks?: object }).experimental_hooks as BeforeDeleteHooks | undefined;
  if (typeof hooks?.experimental_beforeThreadDelete !== "function") return false;
  hooks.experimental_beforeThreadDelete(({ threadId }) => exportBeforeDelete(bb, settings(), threadId, Date.now()));
  return true;
}
