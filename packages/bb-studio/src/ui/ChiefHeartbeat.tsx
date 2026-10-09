// The Chief of Staff's heartbeat, opened by CHIEF_DIALOG_EVENT. Promoting
// and demoting happen in Studio Sidebar's Promote menu; this only schedules.
import { errorMessage } from "@bb-studio/kit/format";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@bb-studio/kit/ui";
import { useState } from "react";
import type { ChiefOfStaffView } from "../contract";
import { HeartbeatFields, useHeartbeatForm } from "./SpaceHeartbeat";
import { useCall, useLive } from "./space/data";

export function ChiefHeartbeatDialog({ onClose }: { onClose(): void }) {
  const call = useCall();
  const chief = useLive<ChiefOfStaffView>("chief_of_staff", {}, { pollMs: 0 });
  const threadId = chief.data?.threadId ?? null;
  const form = useHeartbeatForm(chief.data?.run ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await call("chief_of_staff_set_run", form.input());
      chief.refresh();
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Chief of Staff heartbeat</DialogTitle>
          <DialogDescription>The heartbeat wakes your Chief of Staff on a schedule to check on every Space and its lead, and report in its thread.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2 text-sm">
          <HeartbeatFields form={form} disabled={busy || chief.loading} needs={threadId || chief.loading ? null : "Promote a thread to Chief of Staff to turn the heartbeat on."} />
          {error ? <p role="alert" className="text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !threadId} onClick={() => void save()}>Save heartbeat</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
