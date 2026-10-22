// Approving a mini app's access: a slim banner over the app while
// capabilities wait, and the dialog that grants them. The dialog asks the
// server for a one-time nonce when it opens and sends it back with Approve,
// so an agent can't approve its own app through RPC or the CLI.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PRIMARY_BUTTON } from "../../kit/app/index";
import { errorMessage } from "../../kit/format";
import { Checkbox } from "../../kit/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../kit/ui/dialog";
import { Icon } from "../../kit/ui/icon";
import type { MiniView } from "../contract";
import type { MiniRpc } from "./use-mini";

/** What a capability lets the app do, in plain words. */
export function describeCapability(capability: string): string {
  if (capability.startsWith("fetch:")) return `Reach ${capability.slice(6).replace(/^\*\./, "any address under ")} over the internet, through Studio`;
  if (capability.startsWith("secret:")) return `Send the secret “${capability.slice(7)}” you store for it, as a request header. The app never sees the value`;
  if (capability === "bb.threads.read") return "See the titles of your recent threads";
  if (capability === "bb.studio.read") return "Search the titles of your Studio items";
  if (capability === "bb.open") return "Open threads and Studio items in BB";
  return capability;
}

export function ApprovalBanner({ mini, rpc }: { mini: MiniView; rpc: MiniRpc }) {
  const [open, setOpen] = useState(false);
  if (!mini.pending.length) return null;
  return (
    <>
      <div className="flex items-center gap-2 border-b border-border bg-warning/10 px-3 py-1.5 text-xs text-foreground" data-mini-approval>
        <Icon name="SecurityCheck" className="size-3.5 shrink-0 text-warning-text" />
        <span className="min-w-0 flex-1 truncate">This mini app asks for access: {mini.pending.map(describeCapability).join("; ")}.</span>
        <button type="button" className="shrink-0 rounded px-2 py-0.5 font-medium text-foreground hover:bg-state-hover" onClick={() => setOpen(true)}>Review</button>
      </div>
      {open ? <ApprovalDialog mini={mini} rpc={rpc} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ApprovalDialog({ mini, rpc, onClose }: { mini: MiniView; rpc: MiniRpc; onClose(): void }) {
  const [prompt, setPrompt] = useState<{ nonce: string; notBefore: number; capabilities: string[] } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    rpc.call("minis.requestApproval", { id: mini.id }).then(
      (result) => {
        if (!live) return;
        setPrompt(result);
        setPicked(new Set(result.capabilities));
        setTimeout(() => live && setReady(true), Math.max(0, result.notBefore - Date.now()) + 50);
      },
      (error) => {
        toast.error(errorMessage(error));
        onClose();
      },
    );
    return () => { live = false; };
  }, [rpc, mini.id, onClose]);

  const approve = async () => {
    if (!prompt) return;
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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Allow “{mini.name.trim() || "Untitled mini app"}” to…</DialogTitle>
          <DialogDescription>Approve only what you expect this app to need. You can take access back in its Settings.</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-2 py-1">
          {(prompt?.capabilities ?? mini.pending).map((capability) => (
            <li key={capability}>
              <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                <Checkbox
                  className="mt-0.5"
                  checked={picked.has(capability)}
                  disabled={!prompt}
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
