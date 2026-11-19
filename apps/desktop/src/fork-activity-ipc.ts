import type { BbDesktopApi } from "@bb/desktop-contract";

export const FORK_ACTIVITY_GET_CHANNEL = "bb-desktop:fork-activity-get";
export const FORK_ACTIVITY_CHANGED_CHANNEL = "bb-desktop:fork-activity-changed";

export type ForkSystemActivity = Awaited<
  ReturnType<Required<BbDesktopApi>["experimental_systemActivity"]>
>;
