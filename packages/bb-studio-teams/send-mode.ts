export const sendModes = ["auto", "steer", "followup", "fork"] as const;
export type SendMode = (typeof sendModes)[number];
export type DispatchAction = Exclude<SendMode, "auto">;

export const sendModeLabels: Record<SendMode, string> = {
  auto: "Auto",
  steer: "Steer",
  followup: "Follow-up",
  fork: "Fork",
};

export type RoutingDecision = { botId: string; action: DispatchAction };
export type RoutingPlan = {
  coordinatorId: string | null;
  collaboratorIds: string[];
  executionMode: "serialized" | "parallel";
  finalizerId: string | null;
  routes: RoutingDecision[];
  source?: "jev" | "providers" | "fallback";
};
export type RoutingSelection = RoutingPlan | (string | RoutingDecision)[];
export type RoutingTask = {
  botId: string;
  /** The session already resolved from an explicit reply, otherwise the primary session. */
  threadId: string | null;
  busy: boolean;
  task: string;
  jobId?: string | null;
};

export const isForkConversation = (key: string) => key.includes(":fork:");
