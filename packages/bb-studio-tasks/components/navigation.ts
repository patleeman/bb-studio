import { openCompanion } from "@bb-studio/kit/app";
import type { BbNavigate } from "@get-bb/plugin-sdk/app";

export function openTaskThread(navigate: Pick<BbNavigate, "toThread">, threadId: string): void {
  if (!openCompanion({ kind: "thread", threadId })) navigate.toThread(threadId);
}
