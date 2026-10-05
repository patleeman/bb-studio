import { errorMessage } from "@bb-studio/kit/format";
import type { useRpc } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import { Button } from "@bb-studio/kit/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@bb-studio/kit/ui";
import { Icon } from "@bb-studio/kit/ui";
import type { BotView, PageMetaView, rpcContract, SnapshotView } from "../contract";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

const message = (error: unknown) => (errorMessage(error));

export function HistoryDialog({
  open,
  onClose,
  page,
  bots,
  rpc,
}: {
  open: boolean;
  onClose(): void;
  page: PageMetaView;
  bots: BotView[];
  rpc: Rpc;
}) {
  const [snapshots, setSnapshots] = useState<SnapshotView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () =>
    rpc.call("snapshots", { id: page.id }).then(
      (result) => setSnapshots(result.snapshots),
      (cause: unknown) => setError(message(cause)),
    );
  useEffect(() => {
    if (open) {
      setError(null);
      void load();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  const who = (actor: string) => {
    if (actor === "user") return "You";
    if (actor.startsWith("bot:")) return bots.find((bot) => bot.id === actor.slice(4))?.name ?? "Bot";
    if (actor.startsWith("agent:")) return "Agent";
    return actor;
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Version history</DialogTitle>
          <DialogDescription>Saved before each agent edit.</DialogDescription>
        </DialogHeader>
        <div className="max-h-80 overflow-auto rounded-md border border-border">
          {snapshots === null ? (
            <p className="p-3 text-sm text-muted-foreground">Loading…</p>
          ) : snapshots.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">No saved versions yet.</p>
          ) : (
            snapshots.map((snapshot) => (
              <div key={snapshot.id} className="flex items-center gap-3 border-b border-border px-3 py-2 text-sm last:border-b-0">
                <Icon name="RotateCcw" className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{snapshot.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {who(snapshot.actor)} · {new Date(snapshot.createdAt).toLocaleString()}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm("Restore this version? The current page is saved first.")) {
                      void run(() => rpc.call("restore", { snapshotId: snapshot.id }));
                    }
                  }}
                >
                  Restore
                </Button>
              </div>
            ))
          )}
        </div>
        {error ? <p className="text-sm text-red-500">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => void run(() => rpc.call("snapshot", { id: page.id, label: "Saved version" }))}>
            Save current version
          </Button>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
