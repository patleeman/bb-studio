export const sendModes = ["auto", "steer", "followup", "fork"] as const;
export type SendMode = (typeof sendModes)[number];
export type DispatchAction = Exclude<SendMode, "auto">;

export const sendModeLabels: Record<SendMode, string> = {
  auto: "Auto",
  steer: "Steer",
  followup: "Follow-up",
  fork: "Fork",
};

/** Commands are parsed once at the send boundary, never from quoted chat history. */
export function parseSendMode(text: string, mode: SendMode = "auto") {
  const match = /^\/(fork|steer|followup|follow-up|queue)(?=\s|$)\s*/iu.exec(
    text.trim(),
  );
  if (!match) return { text: text.trim(), mode };
  const command = match[1]!.toLowerCase();
  const action: DispatchAction =
    command === "fork" || command === "steer" ? command : "followup";
  if (mode !== "auto" && mode !== action)
    throw new Error(
      `The /${command} command conflicts with the selected ${sendModeLabels[mode]} mode.`,
    );
  return { text: text.trim().slice(match[0].length).trim(), mode: action };
}

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
