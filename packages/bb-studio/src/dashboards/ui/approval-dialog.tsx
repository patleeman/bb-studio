// The approval dialog for a script widget: the exact command, where and how
// often it runs, its limits and who proposed it, with Deny focused. Opening
// it fetches a one-time nonce (server/approvals.ts); Approve spends it.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Icon } from "@bb-studio/kit/ui";
import { errorMessage } from "@bb-studio/kit/format";
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

export function ApprovalDialog({ dashboardId, widget, rpc, onClose, onApproved }: {
  dashboardId: string;
  widget: WidgetView;
  rpc: Rpc;
  onClose(): void;
  onApproved(): void;
}) {
  const [prompt, setPrompt] = useState<ApprovalPrompt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const deny = useRef<HTMLButtonElement>(null);
  const spent = useRef(false);
  const nonce = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    void rpc.call("dashboards.requestApproval", { id: dashboardId, widgetId: widget.id }).then(
      ({ prompt: next }) => {
        if (!live) return void rpc.call("dashboards.cancelApproval", { nonce: next.nonce }).catch(() => {});
        nonce.current = next.nonce;
        setPrompt(next);
      },
      (cause: unknown) => live && setError(errorMessage(cause)),
    );
    return () => {
      live = false;
      // Closing without approving: the nonce stops working.
      if (nonce.current && !spent.current) void rpc.call("dashboards.cancelApproval", { nonce: nonce.current }).catch(() => {});
    };
  }, [dashboardId, rpc, widget.id]);

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
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  };

  const name = widget.title || WIDGETS[widget.type].label;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
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
            <Row icon="Laptop" label="Runs on"><span className="font-medium">{prompt.host}</span><span className="text-muted-foreground">, the BB host</span></Row>
            <Row icon="TimeSchedule" label="Schedule">{schedule(prompt)}</Row>
            <Row icon="Limitation" label="Limits">Stopped after {prompt.timeoutSec} s; output up to {describeBytes(prompt.maxOutputBytes)}</Row>
            <Row icon={prompt.proposedBy?.actor === "user" ? "UserRound" : "Bot"} label="Proposed by">{proposer(prompt)}</Row>
          </dl>
        ) : error ? null : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Icon name="Loading" className="size-4 animate-spin" /> Checking the command…</p>
        )}

        {error ? <p role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</p> : null}

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <p className="text-xs text-muted-foreground">Any change to the command or folder needs a new approval.</p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button ref={deny} variant="outline" size="sm" onClick={onClose} data-approval-deny>Deny</Button>
            <Button size="sm" disabled={!prompt || !ready || busy} onClick={() => void approve()} data-approval-approve>Approve</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
