import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import {
  BrowserWindow,
  type Dialog,
  type IpcMain,
  type IpcMainInvokeEvent,
} from "electron";
import {
  BB_DESKTOP_FORK_ANSWER_APPROVAL_CHANNEL,
  type ForkApprovalAnswerResult,
} from "./fork-approvals-ipc.js";

export const APPROVAL_PUBLIC_KEY_ENV = "BB_APPROVAL_PUBLIC_KEY";

interface PendingApproval {
  id: string;
  kind: "plugin" | "pair-browser";
  pluginId: string;
  title: string;
  message: string;
  detail: string | null;
  items: { id: string; label: string }[];
  confirmLabel: string;
}

export function approvalSigningPayload(
  approvalId: string,
  decision: { approved: boolean; picked: string[] },
): Buffer {
  return Buffer.from(
    JSON.stringify([
      "bb-approval-v1",
      approvalId,
      decision.approved,
      [...decision.picked].sort(),
    ]),
  );
}

export function createApprovalSigner(
  env: Record<string, string | undefined>,
): (
  approvalId: string,
  decision: { approved: boolean; picked: string[] },
) => string {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  env[APPROVAL_PUBLIC_KEY_ENV] = publicKey
    .export({ type: "spki", format: "der" })
    .toString("base64url");
  const key: KeyObject = privateKey;
  return (approvalId, decision) =>
    sign(null, approvalSigningPayload(approvalId, decision), key).toString(
      "base64url",
    );
}

const signApproval = createApprovalSigner(process.env);

export function approvalDialogText(approval: PendingApproval): {
  message: string;
  detail: string;
} {
  const lines = [approval.message];
  if (approval.items.length > 0) {
    lines.push("", ...approval.items.map((item) => `•  ${item.label}`));
  }
  if (approval.detail !== null && approval.detail.length > 0) {
    lines.push("", approval.detail);
  }
  lines.push(
    "",
    approval.kind === "pair-browser"
      ? "Asked by bb."
      : `Asked by the ${approval.pluginId} plugin.`,
  );
  return { message: approval.title, detail: lines.join("\n").trim() };
}

function isPendingApproval(value: unknown): value is PendingApproval {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.message === "string" &&
    typeof candidate.confirmLabel === "string" &&
    Array.isArray(candidate.items)
  );
}

const open = new Set<string>();

async function answerApproval(
  dialog: Dialog,
  event: IpcMainInvokeEvent,
  approvalId: unknown,
): Promise<ForkApprovalAnswerResult> {
  if (typeof approvalId !== "string" || !/^apr_[\w-]+$/u.test(approvalId)) {
    return "unavailable";
  }
  if (open.has(approvalId)) return "answered";
  let base: string;
  try {
    base = new URL(event.senderFrame?.url ?? "").origin;
  } catch {
    return "unavailable";
  }
  const api = `${base}/api/v1/fork/approvals/${approvalId}`;
  open.add(approvalId);
  try {
    const response = await fetch(api);
    if (!response.ok) return "unavailable";
    const approval: unknown = await response.json();
    if (!isPendingApproval(approval)) return "unavailable";
    const text = approvalDialogText(approval);
    const window = BrowserWindow.fromWebContents(event.sender);
    const options = {
      type: "question" as const,
      title: "bb",
      message: text.message,
      detail: text.detail,
      buttons: [approval.confirmLabel, "Deny"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    };
    const result =
      window === null
        ? await dialog.showMessageBox(options)
        : await dialog.showMessageBox(window, options);
    const decision = {
      approved: result.response === 0,
      picked:
        result.response === 0 ? approval.items.map((item) => item.id) : [],
    };
    const resolved = await fetch(`${api}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...decision,
        signature: signApproval(approvalId, decision),
      }),
    });
    return resolved.ok ? "answered" : "unavailable";
  } catch {
    return "unavailable";
  } finally {
    open.delete(approvalId);
  }
}

export function registerForkApprovalIpc(
  ipcMain: IpcMain,
  dialog: Dialog,
): void {
  ipcMain.handle(
    BB_DESKTOP_FORK_ANSWER_APPROVAL_CHANNEL,
    (event, approvalId: unknown) => answerApproval(dialog, event, approvalId),
  );
}
