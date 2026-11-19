// Push status and "Send a test push", the last section of Studio's settings
// page (Phone notifications). The Studio Mobile plugin sends the pushes but
// has no frontend of its own, so Studio draws this for it (Studio is always
// installed with its add-ons) and asks it through Studio's server
// (mobile.push.status, mobile.push.test).
import { useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useState } from "react";
import { openAppPath } from "../../kit/app/nav";
import { errorMessage } from "../../kit/format";
import { Button, cn } from "../../kit/ui/index";
import type { DeskHoldStatus, PushStatus, PushTest, settingsContract } from "../contract";
import { Card, Row, Switch } from "./controls";

const MOBILE_SETTINGS = "/settings/plugins/mobile";

function ago(at: number, now = Date.now()): string {
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** The status line's words, from what the Mobile plugin answered. */
export function pushWords(status: PushStatus): { headline: string; detail: string; ok: boolean } {
  if (!status.installed) return { headline: "Not installed", detail: status.problem ?? "", ok: false };
  if (!status.ready) return { headline: "Not set up", detail: status.problem ?? "Add the APNs key and Key ID.", ok: false };
  const phones = `${status.devices} phone${status.devices === 1 ? "" : "s"}`;
  const last = status.lastDelivery ? `Last push ${ago(status.lastDelivery.at)}, to ${status.lastDelivery.sent} phone${status.lastDelivery.sent === 1 ? "" : "s"}.` : "No push sent yet.";
  return { headline: status.devices ? `Sending to ${phones}` : "Ready", detail: status.devices ? last : "No phone has received a push yet. Open the BB Studio app and allow notifications.", ok: true };
}

export const DESK_HOLD_LABEL = "Hold phone notifications while I'm at my Mac";

/** The switch row's status line. */
export function deskWords(desk: DeskHoldStatus): string {
  if (!desk.enabled) return "Off";
  const held = desk.held ? ` · ${desk.held} waiting` : "";
  if (desk.atDesk === true) return `At your Mac${held}`;
  if (desk.atDesk === false) return `Away from your Mac${held}`;
  return "No signal from your Mac";
}

export function PushSection() {
  const rpc = useRpc<typeof settingsContract>();
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<{ running: boolean; result: PushTest | null }>({ running: false, result: null });
  const load = useCallback(() => {
    setError(null);
    void rpc.call("mobile.push.status", null).then(setStatus, (cause) => setError(errorMessage(cause)));
  }, [rpc]);
  useEffect(load, [load]);
  const send = async () => {
    setTest({ running: true, result: null });
    try {
      setTest({ running: false, result: await rpc.call("mobile.push.test", null) });
    } catch (cause) {
      setTest({ running: false, result: { ok: false, sent: 0, message: errorMessage(cause) } });
    }
    load();
  };
  const [desk, setDesk] = useState<{ saving: boolean; error: string | null }>({ saving: false, error: null });
  const setHold = async (enabled: boolean) => {
    setDesk({ saving: true, error: null });
    try {
      const deskHold = await rpc.call("mobile.desk.hold", { enabled });
      setStatus((current) => (current ? { ...current, deskHold } : current));
      setDesk({ saving: false, error: null });
    } catch (cause) {
      setDesk({ saving: false, error: errorMessage(cause) });
    }
  };
  const words = status ? pushWords(status) : null;
  return (
    <Card>
      <Row label="Push status" description={error ?? words?.detail ?? "Checking…"} testId="mobile-push-status">
        {words ? <span className={cn("text-sm", words.ok ? "text-success" : "text-muted-foreground")}>{words.headline}</span> : null}
      </Row>
      {status?.deskHold ? (
        <Row label={DESK_HOLD_LABEL} description={desk.error ?? deskWords(status.deskHold)} testId="mobile-desk-hold">
          <Switch checked={status.deskHold.enabled} label={DESK_HOLD_LABEL} disabled={desk.saving} onChange={(next) => void setHold(next)} />
        </Row>
      ) : null}
      <Row label="Send a test push" description={test.result?.message}>
        <Button type="button" size="sm" variant="outline" disabled={!status?.ready || test.running} onClick={() => void send()}>{test.running ? "Sending…" : "Send a test push"}</Button>
      </Row>
      <Row label="APNs key and Key ID">
        <Button type="button" size="sm" variant="ghost" onClick={() => openAppPath(MOBILE_SETTINGS)}>Open</Button>
      </Row>
    </Card>
  );
}
