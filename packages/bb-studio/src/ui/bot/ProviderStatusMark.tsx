import * as BbApp from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import { Icon } from "../../kit/ui/index";
import { ProviderLogo } from "./BotAvatar";

export type ProviderStatusTone = "needs" | "running" | "waiting" | "failed" | "idle";
export type ProviderRingState = "running" | "idle" | "waiting" | "failed";
export type ProviderCatalogEntry = ReturnType<typeof BbApp.experimental_useProviders>["providers"][number];

const WORKING_THREAD_STATUSES = new Set(["active", "starting", "stopping"]);

/** A thread's state; one held by a question or approval (its Bot's to handle) is waiting. */
export function threadStatusTone(status: string, waitingForAnswer = false): ProviderStatusTone {
  if (waitingForAnswer) return "waiting";
  if (WORKING_THREAD_STATUSES.has(status)) return "running";
  if (status === "pending") return "waiting";
  if (/error|fail/i.test(status)) return "failed";
  return "idle";
}

export function providerRingState(tone: ProviderStatusTone): ProviderRingState {
  if (tone === "needs" || tone === "waiting") return "waiting";
  return tone;
}

/** A runner is running only while a run is going on; between runs it's idle, however active its schedule. */
export function runnerStatusTone(state: "active" | "paused", running = false): ProviderStatusTone {
  if (running && state === "active") return "running";
  return "idle";
}

/** Finds the host's provider catalog entry used by its shared icon renderer. */
export function resolveProviderIcon(providerId: string | null | undefined, providers: readonly ProviderCatalogEntry[]): ProviderCatalogEntry | null {
  return providerId ? providers.find((provider) => provider.id === providerId) ?? null : null;
}

/**
 * A row's state, the same wherever Bot rows show (the Bot sidebar's Running,
 * Runners and Schedule, and Bot info), on desktop and iOS
 * (docs/ui-redo/C/REDO.md has the shared spec). Only running rows move.
 * - running (a thread working, a runner mid-run): the logo in full color in
 *   a green arc that turns once every 1.6 s. Under reduced motion the arc
 *   stops: a full green ring and a still "live" dot.
 * - needs (waiting for you): full color, a still amber ring.
 * - failed: full color, a still red ring.
 * - waiting (to start, or a runner's machine offline): dimmed, a hairline ring.
 * - idle (done, quiet, reported, paused, scheduled): dimmed and grey, no ring.
 */
const RING: Partial<Record<ProviderStatusTone, string>> = {
  needs: "text-warning",
  failed: "text-destructive",
  waiting: "text-muted-foreground opacity-30",
};

function toneLabel(tone: ProviderStatusTone): string {
  if (tone === "needs") return "Waiting for you";
  if (tone === "waiting") return "Waiting to start";
  return tone === "running" ? "Running" : tone === "failed" ? "Failed" : "Idle";
}

/** Re-renders every `ms` while `enabled`, for ticking times. */
export function useNow(ms: number, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms, enabled]);
  return now;
}

/** "0:42", "12:05", "1:02:10": how long a run has been going. */
export function elapsedClock(since: number, now = Date.now()): string {
  const total = Math.max(0, Math.floor((now - since) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

/** "Running for 12 minutes", for a screen reader. */
export function runningLabel(since: number | null | undefined, now = Date.now()): string {
  if (since == null) return "Running";
  const minutes = Math.floor((now - since) / 60_000);
  if (minutes < 1) return "Running for less than a minute";
  if (minutes < 60) return `Running for ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  return `Running for ${hours} hour${hours === 1 ? "" : "s"}${minutes % 60 ? ` ${minutes % 60} minutes` : ""}`;
}

/** A running row's ticking elapsed time (each second); nothing without a start. */
export function Elapsed({ since, className = "" }: { since: number | null | undefined; className?: string }) {
  const now = useNow(1000, since != null);
  if (since == null) return null;
  return <time dateTime={new Date(since).toISOString()} aria-label={runningLabel(since, now)} className={`shrink-0 tabular-nums ${className}`}>{elapsedClock(since, now)}</time>;
}

/**
 * BB's provider artwork, marked with the row's state, in a fixed 16px box: an
 * 11px logo inside a 1.5px ring (the running arc is 2px). `label` overrides
 * the spoken state ("Next run 5:15 PM, last run quiet").
 */
export function ProviderStatusMark({ providerId, tone, providers, label }: {
  providerId?: string | null;
  tone: ProviderStatusTone;
  providers: readonly ProviderCatalogEntry[];
  label?: string;
}) {
  const provider = resolveProviderIcon(providerId, providers);
  const spoken = `${provider?.displayName ?? (providerId ? "Unknown provider" : "Provider")} · ${label ?? toneLabel(tone)}`;
  const running = tone === "running";
  const dim = tone === "idle" || tone === "waiting";
  const ring = RING[tone];
  return (
    <span role="img" aria-label={spoken} title={spoken} data-provider-status={providerRingState(tone)} data-tone={tone}
      className="relative flex size-4 shrink-0 items-center justify-center">
      <span className={`flex items-center justify-center ${dim ? "opacity-45 grayscale" : ""}`}>
        {provider
          ? <ProviderLogo provider={provider} className="size-[11px]" />
          : <Icon name="Bot" className="size-[11px] text-muted-foreground" aria-hidden />}
      </span>
      {running ? (
        <>
          <svg viewBox="0 0 16 16" aria-hidden className="absolute inset-0 size-4 text-success">
            <circle className="bb-run-track" cx="8" cy="8" r="7.25" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
            {/* A quarter of the circle (2πr ≈ 44), turning. */}
            <circle className="bb-run-arc" cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="11 33" />
          </svg>
          <span aria-hidden className="bb-run-dot absolute -right-px -bottom-px hidden size-1.5 rounded-full bg-success ring-2 ring-[var(--sidebar,var(--background))]" />
        </>
      ) : ring ? (
        <svg viewBox="0 0 16 16" aria-hidden className={`absolute inset-0 size-4 ${ring}`}>
          <circle cx="8" cy="8" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      ) : null}
    </span>
  );
}
