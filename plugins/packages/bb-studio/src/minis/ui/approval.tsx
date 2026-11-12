// Approving a mini app's access: a slim banner over the app while
// capabilities wait, and the dialog that grants them. Review asks the server
// for a one-time nonce and the dialog sends it back with Approve, so an agent
// can't approve its own app through RPC or the CLI. A BB with its own
// approval dialog shows the request there: Studio's dialog is never drawn.
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PRIMARY_BUTTON } from "../../kit/app/index";
import { errorMessage } from "../../kit/format";
import { Checkbox } from "../../kit/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../../kit/ui/dialog";
import { Icon } from "../../kit/ui/icon";
import { describeCapability } from "../capabilities";
import type { MiniView } from "../contract";

export { describeCapability };
import type { MiniRpc } from "./use-mini";


export function ApprovalBanner({ mini, rpc }: { mini: MiniView; rpc: MiniRpc }) {
  const [prompt, setPrompt] = useState<ApprovalPrompt | null>(null);
  const asking = useRef(false);
  if (!mini.pending.length) return null;
  // Asks once, and shows Studio's dialog only when BB doesn't show its own.
  const review = () => {
    if (asking.current) return;
    asking.current = true;
    rpc.call("minis.requestApproval", { id: mini.id }).then(
      (result) => {
        if (result.host) toast.message("Answer in BB's dialog.");
        else setPrompt(result);
      },
      (error) => toast.error(errorMessage(error)),
    ).finally(() => { asking.current = false; });
  };
  return (
    <>
      <div className="flex items-center gap-2 border-b border-border bg-warning/10 px-3 py-1.5 text-xs text-foreground" data-mini-approval>
        <Icon name="SecurityCheck" className="size-3.5 shrink-0 text-warning-text" />
        <span className="min-w-0 flex-1 truncate">This mini app asks for access: {mini.pending.map(describeCapability).join("; ")}.</span>
        <button type="button" className="shrink-0 rounded px-2 py-0.5 font-medium text-foreground hover:bg-state-hover" onClick={review}>Review</button>
      </div>
      {prompt ? <ApprovalDialog key={prompt.nonce} mini={mini} rpc={rpc} prompt={prompt} onClose={() => setPrompt(null)} /> : null}
    </>
  );
}

interface ApprovalPrompt { nonce: string; notBefore: number; capabilities: string[] }

function ApprovalDialog({ mini, rpc, prompt, onClose }: { mini: MiniView; rpc: MiniRpc; prompt: ApprovalPrompt; onClose(): void }) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(prompt.capabilities));
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  // Approve works once the dialog has been up a moment (the server checks too).
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), Math.max(0, prompt.notBefore - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [prompt.notBefore]);

  const approve = async () => {
    setBusy(true);
    try {
      await rpc.call("minis.approve", { id: mini.id, nonce: prompt.nonce, capabilities: [...picked] });
      toast.success("Access approved.");
      onClose();
    } catch (error) {
      toast.error(errorMessage(error));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent aria-describedby={undefined} className="max-w-md">
        <DialogHeader>
          <DialogTitle>Allow “{mini.name.trim() || "Untitled mini app"}” to…</DialogTitle>
        </DialogHeader>
        <ul className="flex flex-col gap-2 py-1">
          {prompt.capabilities.map((capability) => (
            <li key={capability}>
              <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                <Checkbox
                  className="mt-0.5"
                  checked={picked.has(capability)}
                  onCheckedChange={(checked) => setPicked((now) => {
                    const next = new Set(now);
                    if (checked === true) next.add(capability);
                    else next.delete(capability);
                    return next;
                  })}
                />
                <span className="min-w-0">
                  <span className="block text-foreground">{describeCapability(capability)}</span>
                  <code className="text-xs text-muted-foreground">{capability}</code>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <button type="button" className="rounded-md px-3 py-1.5 text-sm hover:bg-state-hover" onClick={onClose}>Not now</button>
          <button type="button" className={PRIMARY_BUTTON} disabled={!ready || busy || picked.size === 0} onClick={() => void approve()}>Approve</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
