// BB's own approval dialog, on a BB that has one (the BB Studio fork).
// Studio's dialogs show what is being asked; the grant itself then needs an
// answer only a person can give: BB shows a native dialog in the desktop
// app, or its own dialog in a browser paired from the desktop app. Agents,
// the CLI and plugin code cannot answer it. On a stock BB this is null and
// Studio's one-time nonce stays the only guard.

export interface HostApprovalRequest {
  title: string;
  message: string;
  detail?: string;
  items?: readonly { id: string; label: string }[];
  confirmLabel?: string;
}

export interface HostApprovalDecision {
  approved: boolean;
  picked: string[];
}

export type HostApproval = (request: HostApprovalRequest) => Promise<HostApprovalDecision>;

interface ApprovalHooks {
  experimental_requestApproval?: HostApproval;
}

/** BB's approval dialog, or null on a BB without it. */
export function hostApproval(bb: { experimental_hooks?: object }): HostApproval | null {
  const hooks = bb.experimental_hooks as ApprovalHooks | undefined;
  const request = hooks?.experimental_requestApproval;
  return typeof request === "function" ? (input) => request.call(hooks, input) : null;
}

/**
 * Runs `grant` once the person approves in BB's dialog, without making the
 * caller wait for the answer. `grant` gets the items the person allowed.
 * A denial, an expiry or a failing `grant` is reported through `failed`.
 */
export function grantAfterHostApproval(ask: HostApproval, request: HostApprovalRequest, grant: (picked: string[]) => void | Promise<void>, failed: (message: string) => void = () => {}): void {
  void ask(request).then(async (decision) => {
    if (!decision.approved) return;
    await grant(decision.picked);
  }).catch((error: unknown) => failed(error instanceof Error ? error.message : String(error)));
}
