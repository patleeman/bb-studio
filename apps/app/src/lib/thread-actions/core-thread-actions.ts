import { MAIN_SPLITS_ENABLED } from "@/lib/split-layout";
import coreThreadActions from "@/core-contributions/thread-actions";
import { collectCoreContributionSlots } from "@/lib/core-contributions";

export const CORE_THREAD_ACTIONS = collectCoreContributionSlots(
  coreThreadActions,
  "threadActions",
).filter((action) => MAIN_SPLITS_ENABLED || action.id !== "split");
