import { BbHttpError } from "@bb/sdk";
import { CliExitError } from "../../action.js";
import { createCliBbSdk } from "../../client.js";

// `bb thread tell` to an archived thread. The server's 409 names the live
// thread that continues it when a handoff recorded one
// (apps/server/src/services/threads/thread-successor.fork.ts). With
// --follow-successor the message goes there; otherwise the error says where
// the work went, or how to find it when nothing recorded that.

export const FOLLOW_SUCCESSOR_HELP =
  "If the thread is archived and was handed off, send to the live thread that continues it";

export interface ArchivedThreadRefusal {
  successorThreadId: string | null;
  successorTitle: string | null;
}

/** The archived-thread refusal in a send error, or null for any other error. */
export function readArchivedThreadRefusal(
  error: unknown,
): ArchivedThreadRefusal | null {
  if (!(error instanceof BbHttpError) || error.status !== 409) return null;
  const body = error.body as {
    code?: unknown;
    details?: {
      reason?: unknown;
      successorThreadId?: unknown;
      successorTitle?: unknown;
    };
  } | null;
  if (body?.code !== "thread_not_writable") return null;
  if (body.details?.reason !== "archived") return null;
  const successorThreadId = body.details.successorThreadId;
  const successorTitle = body.details.successorTitle;
  return {
    successorThreadId:
      typeof successorThreadId === "string" ? successorThreadId : null,
    successorTitle: typeof successorTitle === "string" ? successorTitle : null,
  };
}

export function archivedThreadError(
  threadId: string,
  refusal: ArchivedThreadRefusal,
  projectId: string | null,
): CliExitError {
  if (refusal.successorThreadId !== null) {
    const title =
      refusal.successorTitle === null ? "" : ` ("${refusal.successorTitle}")`;
    return new CliExitError(
      `Thread ${threadId} is archived. It continues in thread ${refusal.successorThreadId}${title}.`,
      1,
      {
        code: "thread_not_writable",
        hint: `Send there with \`bb thread tell ${refusal.successorThreadId}\`, or add --follow-successor.`,
      },
    );
  }
  const list =
    projectId === null
      ? "`bb thread list`"
      : `\`bb thread list --project ${projectId}\``;
  return new CliExitError(
    `Thread ${threadId} is archived, and no handoff names a thread that continues it.`,
    1,
    {
      code: "thread_not_writable",
      hint: `Find the live thread with ${list}, or unarchive this one with \`bb thread unarchive ${threadId}\`.`,
    },
  );
}

export interface SendToLiveThreadArgs {
  threadId: string;
  follow: boolean;
  getUrl: () => string;
}

export interface SentToLiveThread<T> {
  threadId: string;
  /** The archived thread the message was meant for, when it went to its successor. */
  redirectedFrom: string | null;
  response: T;
}

/** Sends to `threadId`; on an archived thread, follows its successor (with `follow`) or explains the refusal. */
export async function sendToLiveThread<T>(
  args: SendToLiveThreadArgs,
  send: (threadId: string) => Promise<T>,
): Promise<SentToLiveThread<T>> {
  try {
    return {
      threadId: args.threadId,
      redirectedFrom: null,
      response: await send(args.threadId),
    };
  } catch (error: unknown) {
    const refusal = readArchivedThreadRefusal(error);
    if (refusal === null) throw error;
    if (args.follow && refusal.successorThreadId !== null) {
      const response = await send(refusal.successorThreadId);
      console.error(
        `Thread ${args.threadId} is archived; sent to thread ${refusal.successorThreadId}, which continues it.`,
      );
      return {
        threadId: refusal.successorThreadId,
        redirectedFrom: args.threadId,
        response,
      };
    }
    const projectId =
      refusal.successorThreadId === null
        ? await createCliBbSdk(args.getUrl())
            .threads.get({ threadId: args.threadId })
            .then((thread) => thread.projectId)
            .catch(() => null)
        : null;
    throw archivedThreadError(args.threadId, refusal, projectId);
  }
}

/** The ids `bb thread tell --json` prints: where it went, and the archived thread when it was redirected. */
export function sentToJson(sent: SentToLiveThread<unknown>): {
  threadId: string;
  redirectedFrom?: string;
} {
  return sent.redirectedFrom === null
    ? { threadId: sent.threadId }
    : { threadId: sent.threadId, redirectedFrom: sent.redirectedFrom };
}
