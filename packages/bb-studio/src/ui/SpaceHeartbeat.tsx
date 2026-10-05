// A Space's optional lead and its heartbeat, opened by SPACE_DIALOG_EVENT
// with dialog "heartbeat". The lead is any thread in the Space; the
// heartbeat wakes it on a schedule and needs one.
import { errorMessage } from "@bb-studio/kit/format";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input } from "@bb-studio/kit/ui";
import { useEffect, useState } from "react";
import type { SpaceThreadView, SpaceView } from "../contract";
import { useCall, useLive, useSpaceLead, useSpaceOf, type Cadence } from "./space/data";

const RUN_LABELS: Record<Cadence, string> = {
  every5minutes: "Every 5 minutes", every15minutes: "Every 15 minutes", every30minutes: "Every 30 minutes",
  hourly: "Every hour", every2hours: "Every 2 hours", every6hours: "Every 6 hours",
  daily: "Daily", weekdays: "Weekdays", weekly: "Weekly", custom: "Custom (cron)",
};
const SELECT = "w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm disabled:opacity-50";

export function SpaceHeartbeatDialog({ space, onClose }: { space: SpaceView; onClose(): void }) {
  const call = useCall();
  const lead = useSpaceLead(space.id);
  const spaceOf = useSpaceOf();
  const recent = useLive<{ threads: SpaceThreadView[] }>("recentThreads", null, { pollMs: 0 });
  const threads = (recent.data?.threads ?? []).filter((thread) => spaceOf(thread.id) === space.id);
  const leadId = lead.data?.leadThreadId ?? null;
  const [cadence, setCadence] = useState<Cadence | "off">("off");
  const [time, setTime] = useState("09:00");
  const [cron, setCron] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = lead.data?.run ?? null;
  useEffect(() => {
    setCadence(run?.enabled ? run.cadence : "off");
    setTime(run?.time ?? "09:00");
    setCron(run?.cron ?? "");
  }, [run?.enabled, run?.cadence, run?.time, run?.cron]);

  const perform = async (method: string, input: unknown) => {
    setBusy(true);
    setError(null);
    try {
      await call(method, input);
      lead.refresh();
      return true;
    } catch (cause) {
      setError(errorMessage(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const setLead = (threadId: string) => void perform("space_set_lead", { spaceId: space.id, threadId: threadId || null });
  const save = async () => {
    const enabled = cadence !== "off";
    const ok = await perform("space_set_run", {
      spaceId: space.id, enabled, cadence: enabled ? cadence : run?.cadence ?? "daily", time,
      ...(cadence === "custom" ? { cron: cron.trim() } : {}),
    });
    if (ok) onClose();
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Lead and heartbeat · {space.name}</DialogTitle>
          <DialogDescription>The lead is one of the Space's threads. The heartbeat wakes it on a schedule to check the Space and post to your Feed.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2 text-sm">
          <label className="block space-y-1">
            <span className="font-medium">Lead</span>
            <select aria-label="Lead thread" className={SELECT} disabled={busy || lead.loading} value={leadId ?? ""} onChange={(event) => setLead(event.target.value)}>
              <option value="">No lead</option>
              {leadId && !threads.some((thread) => thread.id === leadId) ? <option value={leadId}>Current lead</option> : null}
              {threads.map((thread) => <option key={thread.id} value={thread.id}>{thread.title}</option>)}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="font-medium">Heartbeat</span>
            <select aria-label="Heartbeat" className={SELECT} disabled={busy || !leadId} value={leadId ? cadence : "off"} onChange={(event) => setCadence(event.target.value as Cadence | "off")}>
              <option value="off">Off</option>
              {(Object.keys(RUN_LABELS) as Cadence[]).map((value) => <option key={value} value={value}>{RUN_LABELS[value]}</option>)}
            </select>
            {!leadId ? <span className="block text-xs text-muted-foreground">Pick a lead to turn the heartbeat on.</span> : null}
          </label>
          {leadId && cadence !== "off" && cadence !== "custom" ? (
            <label className="flex items-center justify-between gap-3">
              <span>Time (minute for hourly cadences)</span>
              <input type="time" value={time} onChange={(event) => setTime(event.target.value)} className="rounded-md border border-border bg-background px-2 py-1" />
            </label>
          ) : null}
          {leadId && cadence === "custom" ? (
            <Input aria-label="Cron expression" placeholder="*/15 9-17 * * 1-5" value={cron} onChange={(event) => setCron(event.target.value)} />
          ) : null}
          {error ? <p role="alert" className="text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !leadId} onClick={() => void save()}>Save heartbeat</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
