import * as BbApp from "@get-bb/plugin-sdk/app";
import type { CSSProperties } from "react";
import { Icon } from "../../kit/ui/index";
import { ProviderLogo } from "./BotAvatar";

export type ProviderStatusTone = "needs" | "running" | "waiting" | "failed" | "idle";
export type ProviderRingState = "running" | "idle" | "waiting" | "failed";
export type ProviderCatalogEntry = ReturnType<typeof BbApp.experimental_useProviders>["providers"][number];

const WORKING_THREAD_STATUSES = new Set(["active", "starting", "stopping"]);

export function threadStatusTone(status: string, needsYou: boolean): ProviderStatusTone {
  if (needsYou) return "needs";
  if (WORKING_THREAD_STATUSES.has(status)) return "running";
  if (status === "pending") return "waiting";
  if (/error|fail/i.test(status)) return "failed";
  return "idle";
}

export function providerRingState(tone: ProviderStatusTone): ProviderRingState {
  if (tone === "needs" || tone === "waiting") return "waiting";
  return tone;
}

export function runnerStatusTone(state: "active" | "paused", urgent: boolean): ProviderStatusTone {
  if (urgent) return "needs";
  return state === "paused" ? "idle" : "running";
}

/** Finds the host's provider catalog entry used by its shared icon renderer. */
export function resolveProviderIcon(providerId: string | null | undefined, providers: readonly ProviderCatalogEntry[]): ProviderCatalogEntry | null {
  return providerId ? providers.find((provider) => provider.id === providerId) ?? null : null;
}

const RING_COLOR: Record<ProviderRingState, string> = {
  running: "var(--success, #2f9e68)",
  idle: "var(--muted-foreground, #737373)",
  waiting: "var(--warning, #d99018)",
  failed: "var(--destructive, #dc3b3b)",
};

function toneLabel(tone: ProviderStatusTone): string {
  if (tone === "needs") return "waiting for you";
  if (tone === "waiting") return "waiting to start";
  return tone;
}

/** BB's provider artwork with a compact, accessible ring for the row state. */
export function ProviderStatusMark({ providerId, tone, providers }: {
  providerId?: string | null;
  tone: ProviderStatusTone;
  providers: readonly ProviderCatalogEntry[];
}) {
  const provider = resolveProviderIcon(providerId, providers);
  const state = providerRingState(tone);
  const label = `${provider?.displayName ?? (providerId ? "Unknown provider" : "Provider")} · ${toneLabel(tone)}`;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-provider-status={state}
      className="bb-provider-ring flex size-4 shrink-0 items-center justify-center rounded-full border bg-background"
      style={{ "--provider-ring-color": RING_COLOR[state] } as CSSProperties}
    >
      {provider
        ? <ProviderLogo provider={provider} className="size-[11px]" />
        : <Icon name="Bot" className="size-[10px] text-muted-foreground" aria-hidden />}
    </span>
  );
}
