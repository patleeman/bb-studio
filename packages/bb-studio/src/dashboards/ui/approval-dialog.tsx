// The approval dialog for a script widget: the exact command, where and how
// often it runs, its limits and who proposed it, with Deny focused. What opens
// it asks for the prompt first (requestScriptApproval) and mounts the dialog
// only when Studio is the one to ask: a BB with its own approval dialog shows
// the request there, and this dialog is never drawn. The prompt carries a
// one-time nonce (server/approvals.ts); Approve spends it.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Icon } from "../../kit/ui/index";
import { errorMessage } from "../../kit/format";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../contract";
import { ago, describeBytes, describeEvery, WIDGETS, type ApprovalPrompt, type WidgetView } from "../shared";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

/** "An agent in “Ops review”, 4m ago". */
export function proposer(prompt: Pick<ApprovalPrompt, "proposedBy">, now = Date.now()): string {
  const by = prompt.proposedBy;
  if (!by) return "Unknown";
  const when = ago(by.at, now);
  if (by.actor === "user") return `You, ${when}`;
  return by.threadTitle ? `An agent in “${by.threadTitle}”, ${when}` : `An agent, ${when}`;
}

/** "Every 5 minutes while the dashboard is open; every 30 minutes otherwise". */
export function schedule(prompt: Pick<ApprovalPrompt, "intervalSec" | "backgroundSec">): string {
  const open = describeEvery(prompt.intervalSec);
  if (prompt.intervalSec >= prompt.backgroundSec) return open;
  return `${open} while the dashboard is open; ${describeEvery(prompt.backgroundSec).toLowerCase()} otherwise`;
}

function Row({ icon, label, children }: { icon: string; label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-baseline gap-3 py-1.5">
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon name={icon} className="size-3.5 shrink-0 translate-y-px" />{label}</dt>
      <dd className="min-w-0 break-words text-sm text-foreground">{children}</dd>
    </div>
  );
}

/** What asking for a script's approval came to: BB asks in its own dialog, Studio's dialog asks with this prompt, or it failed. */
export type ApprovalRequest = { kind: "host" } | { kind: "prompt"; prompt: ApprovalPrompt } | { kind: "failed"; error: string };

/** Asks once. A second request would issue a second nonce, and on a BB with its own dialog a second dialog. */
export function requestScriptApproval(rpc: Rpc, dashboardId: string, widgetId: string): Promise<ApprovalRequest> {
  return rpc.call("dashboards.requestApproval", { id: dashboardId, widgetId }).then(
    ({ prompt, host }): ApprovalRequest => host ? { kind: "host" } : { kind: "prompt", prompt },
    (cause: unknown): ApprovalRequest => ({ kind: "failed", error: errorMessage(cause) }),
  );
}

/** Closing without approving: the nonce stops working. */
export function cancelScriptApproval(rpc: Rpc, nonce: string): void {
  void rpc.call("dashboards.cancelApproval", { nonce }).catch(() => {});
}

export function ApprovalDialog({ dashboardId, widget, rpc, prompt, failed = null, onClose, onApproved }: {
  dashboardId: string;
  widget: WidgetView;
  rpc: Rpc;
  /** The prompt already asked for; null when asking failed. */
  prompt: ApprovalPrompt | null;
  /** Why asking failed. */
  failed?: string | null;
  /** `spent`: Approve was sent, so the nonce is used up and needs no cancel. */
  onClose(spent: boolean): void;
  onApproved(): void;
}) {
  const [error, setError] = useState<string | null>(failed);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const deny = useRef<HTMLButtonElement>(null);
  const spent = useRef(false);

  // Approve works once the dialog has been up a moment (the server checks too).
  useEffect(() => {
    if (!prompt) return;
    const timer = setTimeout(() => setReady(true), Math.max(0, prompt.notBefore - Date.now()));
    return () => clearTimeout(timer);
  }, [prompt]);

  const approve = async () => {
    if (!prompt || busy) return;
    setBusy(true);
    setError(null);
    try {
      spent.current = true;
      await rpc.call("dashboards.approveScript", { id: dashboardId, widgetId: widget.id, sha256: prompt.sha256, nonce: prompt.nonce });
      onApproved();
      onClose(true);
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  };

  const name = widget.title || WIDGETS[widget.type].label;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose(spent.current)}>
      <DialogContent
        className="gap-5 sm:max-w-xl"
        data-dashboard-approval
        onOpenAutoFocus={(event) => { event.preventDefault(); deny.current?.focus(); }}
      >
        <DialogHeader className="gap-1 pr-6">
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-300"><Icon name="Terminal" className="size-4" /></span>
            Run this command for “{name}”?
          </DialogTitle>
          <DialogDescription>
            It runs with your shell and your permissions, on a schedule. Approve it only if you know what it does.
          </DialogDescription>
        </DialogHeader>

        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-muted/50 px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-foreground" aria-label="Command" data-approval-command>
          {prompt?.command ?? widget.source.command ?? ""}
        </pre>

        {prompt ? (
          <dl className="-my-1.5 divide-y divide-border/60">
            <Row icon="Folder" label="Folder"><span className="font-mono text-[12.5px]">{prompt.cwd}</span>{prompt.cwdIsHome ? <span className="text-muted-foreground"> (home)</span> : null}</Row>
            <Row icon="Laptop" label="Runs on"><span className="font-medium">{prompt.host}</span></Row>
            <Row icon="TimeSchedule" label="Schedule">{schedule(prompt)}</Row>
            <Row icon="Limitation" label="Limits">Stopped after {prompt.timeoutSec} s; output up to {describeBytes(prompt.maxOutputBytes)}</Row>
            <Row icon={prompt.proposedBy?.actor === "user" ? "UserRound" : "Bot"} label="Proposed by">{proposer(prompt)}</Row>
          </dl>
        ) : error ? null : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Icon name="Loading" className="size-4 animate-spin" /> Checking the command…</p>
        )}

        {error ? <p role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</p> : null}

        <DialogFooter className="items-center gap-2 sm:justify-end">
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button ref={deny} variant="outline" size="sm" onClick={() => onClose(spent.current)} data-approval-deny>Deny</Button>
            <Button size="sm" disabled={!prompt || !ready || busy} onClick={() => void approve()} data-approval-approve>Approve</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
