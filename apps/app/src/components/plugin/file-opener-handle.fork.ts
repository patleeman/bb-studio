import type { PluginPanelFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import type { PluginFileOpenerSlot } from "@/lib/plugin-slots";
import {
  fileOpenerIdFromActionId,
  parseFileOpenerParams,
} from "./file-opener-tabs";

export const FILE_OPENER_HANDLE_OPEN_TIMEOUT_MS = 3000;

export async function callFileOpenerHandleOpen(
  handler: () => boolean | Promise<boolean>,
  timeoutMs: number = FILE_OPENER_HANDLE_OPEN_TIMEOUT_MS,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    const handled = await Promise.race([
      Promise.resolve().then(handler),
      timeout,
    ]);
    return handled === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function fileOpenerHandleOpen(
  openerTab: PluginPanelFixedPanelTab | null,
  fileOpeners: readonly PluginFileOpenerSlot[],
): (() => Promise<boolean>) | null {
  if (openerTab === null) return null;
  const openerId = fileOpenerIdFromActionId(openerTab.actionId);
  const handler = fileOpeners.find(
    (opener) =>
      opener.pluginId === openerTab.pluginId && opener.id === openerId,
  )?.experimental_handleOpen;
  const file = parseFileOpenerParams(openerTab.paramsJson);
  if (handler === undefined || file === null) return null;
  return () =>
    callFileOpenerHandleOpen(() =>
      handler({
        path: file.path,
        source: file.source,
        lineRange: openerTab.fileOpenerOwner?.tab.lineRange ?? null,
      }),
    );
}

export function forkDeferUntilHandled<Change>(
  update: (change: Change) => void,
  args: {
    openerTab: PluginPanelFixedPanelTab | null;
    fileOpeners: readonly PluginFileOpenerSlot[];
    behavior: string;
    viewer: unknown;
  },
): (change: Change) => void {
  const handleOpen =
    args.behavior === "open" && args.viewer === undefined
      ? fileOpenerHandleOpen(args.openerTab, args.fileOpeners)
      : null;
  if (handleOpen === null) return update;
  return (change) => {
    void handleOpen().then((handled) => {
      if (!handled) update(change);
    });
  };
}
