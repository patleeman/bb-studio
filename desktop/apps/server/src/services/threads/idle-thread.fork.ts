import type { SessionOptionSelections, Thread } from "@bb/domain";
import { seedThreadSessionOptionSelections } from "./thread-session-options.js";

export function createsIdleThread(request: {
  originKind?: string | null;
  origin?: string | null;
  input: readonly unknown[];
}): boolean {
  return (
    (request.originKind ?? null) === null &&
    request.origin === "plugin" &&
    request.input.length === 0
  );
}

export function startsIdleThread(
  deps: Parameters<typeof seedThreadSessionOptionSelections>[0],
  request: Parameters<typeof createsIdleThread>[0] & {
    sessionOptions?: SessionOptionSelections;
  },
  thread: Thread,
): boolean {
  if (!createsIdleThread(request)) return false;
  seedThreadSessionOptionSelections(deps, {
    thread,
    selections: request.sessionOptions ?? {},
  });
  return true;
}
