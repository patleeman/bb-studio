import type { useRpc } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { BotView, PageMetaView, rpcContract, SnapshotView } from "../contract";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

function BotPicker({ bots, value, onChange }: { bots: BotView[]; value: string; onChange(id: string): void }) {
  if (!bots.length) {
    return <p className="text-sm text-muted-foreground">No bots yet. Create one in Studio Teams first.</p>;
  }
  return (
    <div className="grid max-h-56 grid-cols-2 gap-1.5 overflow-auto">
      {bots.map((bot) => (
        <button
          key={bot.id}
          type="button"
          onClick={() => onChange(bot.id)}
          className={cn(
            "flex min-w-0 items-center gap-2 rounded-md border px-2.5 py-2 text-left text-sm",
            value === bot.id ? "border-foreground/40 bg-state-active" : "border-border hover:bg-state-hover",
          )}
        >
          <span className="text-lg leading-none">{bot.avatar}</span>
          <span className="min-w-0">
            <span className="block truncate font-medium">{bot.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{bot.working ? "Working…" : `@${bot.handle}`}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

const SCHEDULES = [
  { label: "Every hour", cron: "0 * * * *" },
  { label: "Every morning", cron: "0 9 * * *" },
  { label: "Weekday mornings", cron: "0 9 * * 1-5" },
  { label: "Monday mornings", cron: "0 9 * * 1" },
];

export function KeepUpdatedDialog({
  open,
  onClose,
  page,
  bots,
  rpc,
}: {
  open: boolean;
  onClose(): void;
  page: PageMetaView;
  bots: { available: boolean; reason: string | null; bots: BotView[] };
  rpc: Rpc;
}) {
  const [botId, setBotId] = useState("");
  const [cron, setCron] = useState(SCHEDULES[1]!.cron);
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setError(null);
    setBotId(page.refresh?.botId ?? bots.bots[0]?.id ?? "");
    setCron(page.refresh?.cron ?? SCHEDULES[1]!.cron);
    setInstructions(page.refresh?.instructions ?? "");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const custom = !SCHEDULES.some((schedule) => schedule.cron === cron);

  const save = async (refresh: { botId: string; cron: string; instructions: string } | null) => {
    setBusy(true);
    setError(null);
    try {
      await rpc.call("setRefresh", { id: page.id, refresh });
      onClose();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Keep this page updated</DialogTitle>
          <DialogDescription>A bot updates the page on a schedule.</DialogDescription>
        </DialogHeader>
        {!bots.available ? <p className="text-sm text-muted-foreground">{bots.reason ?? "Studio Teams is not available."}</p> : null}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">Owner</span>
          <BotPicker bots={bots.bots} value={botId} onChange={setBotId} />
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">Schedule</span>
          <div className="flex flex-wrap gap-1.5">
            {SCHEDULES.map((schedule) => (
              <Button
                key={schedule.cron}
                size="sm"
                variant="outline"
                aria-pressed={cron === schedule.cron}
                className="aria-pressed:bg-state-active"
                onClick={() => setCron(schedule.cron)}
              >
                {schedule.label}
              </Button>
            ))}
            <Button
              size="sm"
              variant="outline"
              aria-pressed={custom}
              className="aria-pressed:bg-state-active"
              onClick={() => !custom && setCron("30 8 * * *")}
            >
              Custom
            </Button>
          </div>
          {custom ? (
            <Input value={cron} onChange={(event) => setCron(event.target.value)} placeholder="minute hour day month weekday" className="font-mono" />
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">What to keep current</span>
          <Textarea
            rows={4}
            placeholder="Update the status table from this week's threads. Move shipped items to Done and add anything new."
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
          />
        </div>
        {error ? <p className="text-sm text-red-500">{error}</p> : null}
        <DialogFooter className="sm:justify-between">
          {page.refresh ? (
            <Button variant="ghost" className="text-destructive" disabled={busy} onClick={() => void save(null)}>
              Stop updating
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={!botId || !cron.trim() || busy} onClick={() => void save({ botId, cron: cron.trim(), instructions: instructions.trim() })}>
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
          <DialogDescription>Saved before each bot or agent edit.</DialogDescription>
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
