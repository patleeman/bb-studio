export const WORK_KINDS = ["worker", "lead", "release", "todo", "task"] as const;
export const WORK_STATES = ["running", "waiting", "needs-you", "done", "failed"] as const;
export const WORK_ID = /^wc_[A-Za-z0-9-]{1,80}$/;
export const SHOW_FINISHED_MS = 24 * 60 * 60 * 1000;

export type WorkKind = (typeof WORK_KINDS)[number];
export type WorkState = (typeof WORK_STATES)[number];

export const FINISHED_STATES: readonly WorkState[] = ["done", "failed"];
export const isFinished = (card: { state: WorkState }) => FINISHED_STATES.includes(card.state);
export const directiveFor = (id: string) => `::work{id="${id}"}`;
