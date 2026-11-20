import type { AppDeps } from "../../../types.js";
import { requirePublicThread } from "../../lib/entity-lookup.js";
import { resolveThreadEnvironmentRestore } from "../../threads/thread-environment-restore.js";
import {
  requestThreadEnvironmentRestore,
  scheduleThreadProvisioningAdvance,
} from "../../threads/thread-provisioning.js";
import { buildThreadStatusChangeMetadata } from "../../threads/thread-runtime-display.js";

export function restoreBroughtOverWorkspaces(
  deps: AppDeps,
  threadIds: readonly string[],
): string[] {
  const restoring: string[] = [];
  for (const threadId of threadIds) {
    try {
      const thread = requirePublicThread(deps.db, threadId);
      const resolution = resolveThreadEnvironmentRestore(deps, { thread });
      if (!resolution.restorable) continue;
      const started = requestThreadEnvironmentRestore(deps, {
        environment: resolution.target.environment,
        provider: {
          environmentProviderId: resolution.target.environmentProviderId,
          selection: resolution.target.selection,
        },
        thread,
      });
      if (started === null) continue;
      deps.hub.notifyThread(
        threadId,
        ["status-changed"],
        buildThreadStatusChangeMetadata(
          deps,
          requirePublicThread(deps.db, threadId),
        ),
      );
      scheduleThreadProvisioningAdvance(deps, threadId);
      restoring.push(threadId);
    } catch (error) {
      deps.logger.warn(
        { threadId, error: error instanceof Error ? error.name : "error" },
        "Bring-over could not restore a brought-over thread's workspace",
      );
    }
  }
  return restoring;
}
