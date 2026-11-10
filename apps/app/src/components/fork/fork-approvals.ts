export interface PendingApproval {
  id: string;
  kind: "plugin" | "pair-browser";
  pluginId: string;
  title: string;
  message: string;
  detail: string | null;
  items: { id: string; label: string }[];
  confirmLabel: string;
}

const API = "/api/v1/fork/approvals";

async function json<T>(response: Response): Promise<T | null> {
  if (!response.ok) return null;
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export async function listPendingApprovals(): Promise<PendingApproval[]> {
  try {
    const body = await json<{ approvals: PendingApproval[] }>(
      await fetch(`${API}/pending`),
    );
    return body?.approvals ?? [];
  } catch {
    return [];
  }
}

export async function readApproverSession(): Promise<boolean> {
  try {
    const body = await json<{ approver: boolean }>(
      await fetch(`${API}/session`, { credentials: "same-origin" }),
    );
    return body?.approver === true;
  } catch {
    return false;
  }
}

export async function resolveApproval(
  id: string,
  decision: { approved: boolean; picked: string[] },
): Promise<boolean> {
  try {
    const response = await fetch(`${API}/${encodeURIComponent(id)}/resolve`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(decision),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function startPairing(): Promise<{
  pairingId: string;
  secret: string;
  approvalId: string;
} | null> {
  try {
    return await json(
      await fetch(`${API}/pairings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
  } catch {
    return null;
  }
}

export async function claimPairing(
  pairingId: string,
  secret: string,
): Promise<boolean> {
  try {
    const body = await json<{ paired: boolean }>(
      await fetch(`${API}/pairings/${encodeURIComponent(pairingId)}/claim`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret }),
      }),
    );
    return body?.paired === true;
  } catch {
    return false;
  }
}

export function nextApprovalForBrowser(
  pending: readonly PendingApproval[],
  handledByDesktop: ReadonlySet<string>,
  ownPairingApprovalId: string | null,
): PendingApproval | null {
  return (
    pending.find(
      (approval) =>
        approval.kind === "plugin" &&
        !handledByDesktop.has(approval.id) &&
        approval.id !== ownPairingApprovalId,
    ) ?? null
  );
}
