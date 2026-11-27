import type { ForkPluginEventPayloads } from "../backend-contract.fork.js";

interface ForkEventThread {
  threadId: string;
  createdAt: number | null;
}

type ForkThreadOfEvent = {
  [E in keyof ForkPluginEventPayloads]: (
    payload: ForkPluginEventPayloads[E],
  ) => ForkEventThread | null;
};

export const FORK_THREAD_OF_EVENT: ForkThreadOfEvent = {
  "experimental_turn.interrupted": ({ thread }) => ({
    threadId: thread.id,
    createdAt: thread.createdAt,
  }),
  "experimental_host.connected": () => null,
  "experimental_host.disconnected": () => null,
  "experimental_thread.fileChanged": ({ thread }) => ({
    threadId: thread.id,
    createdAt: thread.createdAt,
  }),
};
