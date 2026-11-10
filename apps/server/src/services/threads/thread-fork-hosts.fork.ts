import type { Thread } from "@bb/domain";

export interface ForkHostStandInArgs {
  sourceThread: Thread;
  sourceHostId: string;
  childHostId: string;
}

export type ForkHostStandIn = (args: ForkHostStandInArgs) => boolean;

const standIns = new Set<ForkHostStandIn>();

export function registerForkHostStandIn(standIn: ForkHostStandIn): () => void {
  standIns.add(standIn);
  return () => {
    standIns.delete(standIn);
  };
}

export function forkHostStandsIn(
  sourceThread: Thread,
  sourceHostId: string | null,
  childHostId: string | null,
): boolean {
  if (sourceHostId === null || childHostId === null) return false;
  for (const standIn of standIns) {
    if (standIn({ sourceThread, sourceHostId, childHostId })) return true;
  }
  return false;
}
