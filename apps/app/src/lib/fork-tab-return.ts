import type { ExperimentalWorkbenchOpenSpec } from "@get-bb/plugin-sdk";
import { findSurface, workbenchFor } from "./fork-workbench";
import {
  parseTabSpec,
  WINDOW_INSTANCE_ID,
  type TabWindowPane,
} from "./fork-tab-popout";

export const TAB_RETURN_CHANNEL = "bb-fork-tab-window";
const ACK_TIMEOUT_MS = 600;
const RETURN_TIMEOUT_MS = 10_000;
const SURFACE_WAIT_MS = 5000;
const SURFACE_POLL_MS = 100;

export interface TabReturn {
  threadId: string;
  projectId: string | null;
  spec: ExperimentalWorkbenchOpenSpec;
  pane: TabWindowPane;
}

type ReturnMessage =
  | ({ type: "return"; id: string; to: string | null } & TabReturn)
  | { type: "ack"; id: string }
  | { type: "returned"; id: string; ok: boolean };

function openChannel(): BroadcastChannel | null {
  return typeof BroadcastChannel === "function"
    ? new BroadcastChannel(TAB_RETURN_CHANNEL)
    : null;
}

function readMessage(data: unknown): ReturnMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const message = data as Record<string, unknown>;
  if (typeof message.id !== "string") return null;
  if (message.type === "ack") return { type: "ack", id: message.id };
  if (message.type === "returned") {
    return { type: "returned", id: message.id, ok: message.ok === true };
  }
  if (message.type !== "return") return null;
  const spec = parseTabSpec(message.spec);
  if (
    spec === null ||
    typeof message.threadId !== "string" ||
    (message.to !== null && typeof message.to !== "string") ||
    (message.projectId !== null && typeof message.projectId !== "string") ||
    (message.pane !== 1 && message.pane !== 2)
  ) {
    return null;
  }
  return {
    type: "return",
    id: message.id,
    to: message.to,
    threadId: message.threadId,
    projectId: message.projectId,
    spec,
    pane: message.pane,
  };
}

function specOwner(spec: ExperimentalWorkbenchOpenSpec): string {
  return spec.kind === "tab" && spec.tab.pluginId !== undefined
    ? spec.tab.pluginId
    : "bb";
}

async function waitForSurface(threadId: string): Promise<boolean> {
  const deadline = Date.now() + SURFACE_WAIT_MS;
  while (findSurface(threadId) === null) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, SURFACE_POLL_MS));
  }
  return true;
}

export async function reopenReturnedTab(
  request: TabReturn,
  showThread: (threadId: string, projectId: string) => void,
): Promise<boolean> {
  if (findSurface(request.threadId) === null) {
    if (request.projectId === null) return false;
    showThread(request.threadId, request.projectId);
    if (!(await waitForSurface(request.threadId))) return false;
  }
  const workbench = workbenchFor(specOwner(request.spec), request.threadId);
  if (workbench === null) return false;
  const pane =
    request.pane === 2 && workbench.layout().panes.length < 2
      ? "new"
      : request.pane;
  const key =
    (await workbench.open(request.spec, { pane })) ??
    (await workbench.open(request.spec));
  return key !== null;
}

export function listenForTabReturns(
  showThread: (threadId: string, projectId: string) => void,
): () => void {
  const channel = openChannel();
  if (channel === null) return () => undefined;
  channel.onmessage = (event: MessageEvent) => {
    const message = readMessage(event.data);
    if (message?.type !== "return") return;
    if (message.to === null) {
      if (findSurface(message.threadId) === null) return;
    } else if (message.to !== WINDOW_INSTANCE_ID) {
      return;
    }
    channel.postMessage({ type: "ack", id: message.id });
    void reopenReturnedTab(message, showThread)
      .catch(() => false)
      .then((ok) => {
        if (ok) window.focus();
        channel.postMessage({ type: "returned", id: message.id, ok });
      });
  };
  return () => channel.close();
}

export function requestTabReturn(
  request: TabReturn & { from: string },
): Promise<boolean> {
  const channel = openChannel();
  if (channel === null) return Promise.resolve(false);
  const id = `${WINDOW_INSTANCE_ID}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
  const { from, ...tab } = request;
  return new Promise((resolve) => {
    let acked = false;
    let broadened = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const finish = (ok: boolean) => {
      timers.forEach(clearTimeout);
      channel.close();
      resolve(ok);
    };
    const send = (to: string | null) => {
      channel.postMessage({ type: "return", id, to, ...tab });
      timers.push(
        setTimeout(() => {
          if (acked) return;
          if (broadened) finish(false);
          else {
            broadened = true;
            send(null);
          }
        }, ACK_TIMEOUT_MS),
      );
    };
    channel.onmessage = (event: MessageEvent) => {
      const message = readMessage(event.data);
      if (message === null || message.id !== id) return;
      if (message.type === "ack") acked = true;
      if (message.type === "returned") finish(message.ok);
    };
    timers.push(setTimeout(() => finish(false), RETURN_TIMEOUT_MS));
    send(from);
  });
}
