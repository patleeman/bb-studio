// Bots that run on an outside agent (Hermes, OpenClaw) through the
// external-agents plugin. They work like any bot; the office marks them and
// shows when their agent can't be reached.
import { useEffect, useState } from "react";

export const EXTERNAL_PROVIDERS: Record<string, string> = {
  hermes: "Hermes",
  openclaw: "OpenClaw",
  dot: "Dot",
};

export function externalAgentName(providerId: string | undefined | null): string | null {
  return providerId ? EXTERNAL_PROVIDERS[providerId] ?? null : null;
}

export interface ExternalHealth {
  online: boolean;
  status: string;
  message: string | null;
}

const POLL_MS = 60_000;

async function fetchHealth(provider: string): Promise<ExternalHealth> {
  try {
    const response = await fetch("/api/v1/plugins/external-agents/rpc/health", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider }),
    });
    const body = await response.json() as { ok?: boolean; result?: Partial<ExternalHealth>; error?: { message?: string } };
    if (!body.ok || !body.result) return { online: false, status: "unavailable", message: body.error?.message ?? "The external-agents plugin isn't running." };
    return { online: Boolean(body.result.online), status: body.result.status ?? "unknown", message: body.result.message ?? null };
  } catch (cause) {
    return { online: false, status: "unavailable", message: cause instanceof Error ? cause.message : String(cause) };
  }
}

/** Health of each external provider in use, refreshed every minute. */
export function useExternalHealth(providerIds: readonly (string | undefined | null)[]): Record<string, ExternalHealth> {
  const wanted = [...new Set(providerIds.filter((id): id is string => Boolean(id && EXTERNAL_PROVIDERS[id])))].sort();
  const key = wanted.join(",");
  const [health, setHealth] = useState<Record<string, ExternalHealth>>({});
  useEffect(() => {
    if (!key) return;
    let live = true;
    const load = () => {
      void Promise.all(key.split(",").map(async (id) => [id, await fetchHealth(id)] as const))
        .then((entries) => { if (live) setHealth(Object.fromEntries(entries)); });
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => { live = false; clearInterval(timer); };
  }, [key]);
  return health;
}
