import {
  FORK_PLUGIN_EVENT_NAMES,
  type ForkPluginEventPayloads,
  type ForkPluginHooks,
} from "../backend-contract.fork.js";

type ForkEventName = keyof ForkPluginEventPayloads;
type ForkEventHandlers = {
  [E in ForkEventName]: Array<
    (payload: ForkPluginEventPayloads[E]) => void | Promise<void>
  >;
};

export function forkEventLists(): ForkEventHandlers {
  return Object.fromEntries(
    FORK_PLUGIN_EVENT_NAMES.map((name) => [name, []]),
  ) as unknown as ForkEventHandlers;
}

export function forkEventCounts(
  handlers: Record<ForkEventName, readonly unknown[]>,
): Record<ForkEventName, number> {
  return Object.fromEntries(
    FORK_PLUGIN_EVENT_NAMES.map((name) => [name, handlers[name].length]),
  ) as Record<ForkEventName, number>;
}

export function forkFakeHooks(): ForkPluginHooks {
  return {
    experimental_classifyTurns() {},
    experimental_beforeThreadDelete() {},
    experimental_turnContext() {},
    experimental_threadForkPoint: () => Promise.resolve(null),
    experimental_requestApproval: () =>
      Promise.resolve({ approved: false, picked: [] }),
  };
}
