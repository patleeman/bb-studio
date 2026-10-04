// Health of the outside agents bots run on, from the external-agents plugin.
// Polled once a minute, and only for providers some shown bot uses.
import { useEffect, useState } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { externalAgent, EXTERNAL_AGENTS } from "./external-agents";

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
    if (!response.ok || body.ok === false || !body.result)
      return { online: false, status: "unavailable", message: body.error?.message ?? "The External Agents plugin isn't running." };
    return { online: Boolean(body.result.online), status: body.result.status ?? "unknown", message: body.result.message ?? null };
  } catch (cause) {
    return { online: false, status: "unavailable", message: cause instanceof Error ? cause.message : String(cause) };
  }
}

/** Health of each outside agent among these providers, refreshed every minute. */
export function useExternalHealth(providerIds: readonly (string | null | undefined)[]): Record<string, ExternalHealth> {
  const key = [...new Set(providerIds.filter((id): id is string => !!externalAgent(id)))].sort().join(",");
  const [health, setHealth] = useState<Record<string, ExternalHealth>>({});
  useEffect(() => {
    if (!key) return;
    let live = true;
    const load = () => void Promise.all(key.split(",").map(async id => [id, await fetchHealth(id)] as const))
      .then(entries => { if (live) setHealth(Object.fromEntries(entries)); });
    load();
    const timer = setInterval(load, POLL_MS);
    return () => { live = false; clearInterval(timer); };
  }, [key]);
  return health;
}

/** Outside agents whose provider is turned on, for choosing one to run a bot on. */
export function useEnabledExternalAgents(): { id: string; name: string; health: ExternalHealth }[] {
  const health = useExternalHealth(Object.keys(EXTERNAL_AGENTS));
  return Object.entries(EXTERNAL_AGENTS)
    .filter(([id]) => health[id] && !["disabled", "unavailable"].includes(health[id]!.status))
    .map(([id, agent]) => ({ id, name: agent.name, health: health[id]! }));
}

/** A small globe that marks a bot running on an outside agent, plus Offline when it can't be reached. */
export function ExternalAgentBadge({ providerId, health, className = "" }: { providerId: string | null | undefined; health?: ExternalHealth; className?: string }) {
  const agent = externalAgent(providerId);
  if (!agent) return null;
  const offline = health?.online === false;
  const title = `Runs on ${agent.name}, an outside agent${offline ? ` · offline${health?.message ? `: ${health.message}` : ""}` : health?.online ? " · online" : ""}`;
  return (
    <span data-external-agent={providerId} title={title} aria-label={title}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[11px] leading-none text-muted-foreground ${className}`}>
      <Icon name="Globe" className="size-3" aria-hidden="true" />
      {agent.name}
      {offline && <span className="text-amber-600 dark:text-amber-400">· Offline</span>}
    </span>
  );
}
