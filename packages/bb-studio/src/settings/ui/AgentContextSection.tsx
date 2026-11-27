// Settings › Agent context: lean context per provider (src/context-lean.ts).
// One row per provider, Auto / Lean / Full; the description states what a
// Bot conversation gets with that provider now. Reads go through the app's
// RPC client; a change goes with this launch's app token, as Tool Gateway's
// do, and the server refuses it from anywhere but BB Studio's own window.
import { useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "../../kit/format";
import type { ContextLeanProvider, contextLeanContract } from "../../context-lean-contract";
import { uiToken } from "../../bring-over/api";
import { canChange, READ_ONLY_NOTE } from "../../tool-gateway/ui/api";
import { Card, Row, Segmented, SubHeading } from "./controls";

async function setMode(input: { providerId: string; mode: Mode }, load: typeof fetch = fetch): Promise<ContextLeanProvider[]> {
  const token = await uiToken();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers["x-bb-studio-ui-token"] = token;
  const response = await load("/api/v1/plugins/studio/rpc/contextLean.set", { method: "POST", headers, body: JSON.stringify(input) });
  const body = (await response.json().catch(() => ({}))) as { ok?: boolean; result?: { providers: ContextLeanProvider[] }; error?: { message?: string } | string };
  if (!response.ok || body.ok !== true || !body.result) throw new Error(typeof body.error === "string" ? body.error : body.error?.message ?? `BB Studio answered ${response.status}`);
  return body.result.providers;
}

type Mode = ContextLeanProvider["mode"];
const MODES: readonly { value: Mode; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "lean", label: "Lean" },
  { value: "full", label: "Full" },
];

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** What the row's description says: the mode in effect and the tools a conversation loads. */
export function describeRow(row: ContextLeanProvider): string {
  const lean = `Lean · ${plural(row.tools.lean, "tool")}`;
  const full = `Full · ${plural(row.tools.full, "tool")}${row.fullDelivery === "search" ? "" : ", most on demand"}`;
  if (row.mode === "lean") return lean;
  if (row.mode === "full") return full;
  return row.acp ? `${lean} with a local model; ${full} otherwise` : full;
}

export function AgentContextSection() {
  const rpc = useRpc<typeof contextLeanContract>();
  const [rows, setRows] = useState<ContextLeanProvider[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [writable, setWritable] = useState(false);
  useEffect(() => { void canChange().then(setWritable); }, []);

  const refresh = useCallback(() => {
    setError(null);
    void rpc.call("contextLean.get", null).then((answer) => setRows(answer.providers), (cause: unknown) => setError(errorMessage(cause)));
  }, [rpc]);
  useEffect(refresh, [refresh]);

  const set = (providerId: string, mode: Mode) => {
    setBusy(true);
    setError(null);
    void setMode({ providerId, mode })
      .then(setRows, (cause: unknown) => setError(errorMessage(cause)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="flex flex-col gap-3" data-testid="agent-context">
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {!writable ? <p className="text-xs text-muted-foreground" data-testid="agent-context-read-only">{READ_ONLY_NOTE}</p> : null}
      <Card>
        <SubHeading>Providers</SubHeading>
        {rows === null ? <p className="px-4 py-3 text-sm text-muted-foreground">Loading</p> : null}
        {rows?.length === 0 ? <p className="px-4 py-3 text-sm text-muted-foreground">No providers</p> : null}
        {rows?.map((row) => (
          <Row key={row.id} label={row.name} description={describeRow(row)} testId={`agent-context-${row.id}`}>
            <Segmented label={`${row.name} context`} value={row.mode} options={MODES} disabled={busy || !writable} onChange={(mode) => set(row.id, mode)} />
          </Row>
        ))}
      </Card>
    </div>
  );
}
