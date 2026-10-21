// A Bot chat's prompt cache on the desktop (src/bot-cache.ts): the header
// dot with its state tooltip and menu, the composer's
// cold-send banner, and the Prompt cache section of Bot info.
import { GHOST_BUTTON } from "@bb-studio/kit/app";
import { errorMessage } from "@bb-studio/kit/format";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Icon } from "@bb-studio/kit/ui";
import { useComposer, type PluginThreadHeaderActionProps } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import type { BotCacheStateView } from "../../contract";
import { formatTokens, formatUsd } from "../../bot-cache-format";
import { useCall, useLive } from "../live";

const POLL_MS = 60_000;

/** Re-renders each `ms`, for the minutes left. */
function useTick(ms: number) {
  const [, setNow] = useState(0);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(timer); }, [ms]);
}

/** The label with minutes counted down between polls. */
export function cacheLabel(state: BotCacheStateView, now = Date.now()): string {
  if (state.state === "warm" && state.warmUntil != null) {
    if (state.warmUntil <= now) return state.warming.active ? "Cold" : state.settings.enabled ? "Cold" : "Warming off";
    return `Warm · ${Math.max(1, Math.ceil((state.warmUntil - now) / 60_000))}m left`;
  }
  return state.label;
}

/** One line on what the cache costs: the next send cold, and warming per hour. */
export function costLine(state: BotCacheStateView): string | null {
  const parts: string[] = [];
  if (state.contextTokens != null) parts.push(`${formatTokens(state.contextTokens)} tokens`);
  if (state.costs.coldSend != null) parts.push(`cold send ≈ ${formatUsd(state.costs.coldSend)}`);
  if (state.costs.warmingPerHour != null) parts.push(`warming ≈ ${formatUsd(state.costs.warmingPerHour)}/h`);
  return parts.length ? parts.join(" · ") : null;
}

const clock = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** The header chip on a Bot's chat; nothing on other threads. */
export function BotCacheChip({ threadId }: PluginThreadHeaderActionProps) {
  const live = useLive<BotCacheStateView>("bot_cache_state", { threadId }, { pollMs: POLL_MS });
  const call = useCall();
  const [error, setError] = useState<string | null>(null);
  useTick(30_000);
  const state = live.data;
  if (!state?.botId) return null;
  const label = cacheLabel(state);
  const warm = label.startsWith("Warm");
  const disabled = label === "Warming off";
  const act = (method: string, input: object) => { setError(null); void call(method, input).then(() => live.refresh(), (cause: unknown) => setError(errorMessage(cause))); };
  const cost = costLine(state);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" data-testid="bot-cache-chip" aria-label={`Prompt cache: ${label}`} title={label}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground">
          <span aria-hidden className={`size-2 rounded-full ${warm ? "bg-success" : disabled ? "bg-muted-foreground/40" : "bg-warning"}`} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <div className="flex flex-col gap-1 px-2 py-1.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Prompt cache: {label}</span>
          {state.warming.reason ? <span>{state.warming.reason}.</span> : null}
          {state.warming.active && state.warming.nextPingAt ? <span>Next keep-alive ping around {clock(state.warming.nextPingAt)}.</span> : null}
          {state.warming.compactAt ? <span>Compacts around {clock(state.warming.compactAt)}.</span> : state.warming.lastCompactAt ? <span>Compacted at {clock(state.warming.lastCompactAt)}.</span> : null}
          {cost ? <span>{cost}</span> : null}
          {error ? <span role="alert" className="text-destructive">{error}</span> : null}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => act("bot_cache_set", { botId: state.botId, enabled: !state.settings.enabled })}>
          <Icon name={state.settings.enabled ? "Pause" : "Play"} />{state.settings.enabled ? "Turn warming off" : "Turn warming on"}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => { if (confirm("Compact this chat? BB summarizes its history; the next send writes the shorter context.")) act("bot_cache_compact", { threadId }); }}>
          <Icon name="Minimize2" />Compact now…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Banners dismissed this session, by thread. */
const dismissed = new Set<string>();

/** The composer banner on a cold Bot chat above the threshold. */
export function BotCacheBanner() {
  const composer = useComposer();
  const threadId = composer.scope.kind === "thread" ? composer.scope.threadId : null;
  return threadId ? <ColdBanner threadId={threadId} /> : null;
}

function ColdBanner({ threadId }: { threadId: string }) {
  const live = useLive<BotCacheStateView>("bot_cache_state", { threadId }, { pollMs: POLL_MS });
  const call = useCall();
  const [hidden, setHidden] = useState(dismissed.has(threadId));
  const state = live.data;
  if (hidden || !state?.botId || !state.banner || state.contextTokens == null) return null;
  const cost = state.costs.coldSend != null ? ` (~${formatUsd(state.costs.coldSend)})` : "";
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground" data-testid="bot-cache-banner" role="status">
      <Icon name="CloudOff" className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">Cache expired — next send re-reads ~{formatTokens(state.contextTokens)} tokens{cost}</span>
      <button type="button" className={GHOST_BUTTON} onClick={() => { dismissed.add(threadId); setHidden(true); }}>Dismiss</button>
      <button type="button" className={GHOST_BUTTON} onClick={() => { setHidden(true); void call("bot_cache_banner_hide", { threadId }); }}>Don't show for this thread</button>
    </div>
  );
}

const THRESHOLDS = [50_000, 100_000, 150_000, 200_000, 300_000];
const IDLE_HOURS = [1, 2, 3, 4, 6, 8];

/** Bot info's Prompt cache section: the state, warming's cost, its settings, and Compact. */
export function BotCacheSection({ botId, threadId }: { botId: string; threadId: string | null }) {
  const live = useLive<BotCacheStateView>("bot_cache_state", { botId }, { pollMs: POLL_MS });
  const call = useCall();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useTick(30_000);
  const state = live.data;
  if (!threadId || !state?.botId) return null;
  const run = async (method: string, input: object) => {
    setBusy(true); setError(null);
    try { await call(method, input); live.refresh(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  };
  const set = (patch: object) => void run("bot_cache_set", { botId, ...patch });
  const { settings } = state;
  const thresholds = THRESHOLDS.includes(settings.thresholdTokens) ? THRESHOLDS : [...THRESHOLDS, settings.thresholdTokens].sort((a, b) => a - b);
  const idles = IDLE_HOURS.includes(settings.idleHours) ? IDLE_HOURS : [...IDLE_HOURS, settings.idleHours].sort((a, b) => a - b);
  const select = "rounded border border-border bg-transparent px-1";
  return (
    <section className="mx-4 mt-3 flex flex-col gap-1.5 rounded-md bg-muted/40 p-2 text-xs" aria-label="Prompt cache" data-testid="bot-cache-section">
      <span className="flex items-center gap-1.5">
        <span className="font-medium text-foreground">Prompt cache</span>
        <span className="text-muted-foreground">{cacheLabel(state)}</span>
        <span className="flex-1" />
        <button type="button" className={GHOST_BUTTON} disabled={busy} title="BB summarizes the chat's history" onClick={() => { if (confirm("Compact this chat? BB summarizes its history; the next send writes the shorter context.")) void run("bot_cache_compact", { threadId }); }}>Compact</button>
      </span>
      <span className="text-muted-foreground">
        {state.costs.warmingPerHour != null ? `Warming ≈ ${formatUsd(state.costs.warmingPerHour)}/h` : "Not priced for this model"}
        {state.costs.coldSend != null ? ` · a cold send ≈ ${formatUsd(state.costs.coldSend)}` : ""}
        {state.contextTokens != null ? ` · ${formatTokens(state.contextTokens)} tokens` : ""}
        {state.warming.reason ? ` · ${state.warming.reason}` : ""}
      </span>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={settings.enabled} disabled={busy} aria-label="Keep the cache warm" onChange={(event) => set({ enabled: event.target.checked })} />
        <span className="text-foreground">Keep the cache warm while I'm around</span>
      </label>
      {settings.enabled ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
          <label className="flex items-center gap-1">above
            <select aria-label="Size threshold" className={select} value={settings.thresholdTokens} disabled={busy} onChange={(event) => set({ thresholdTokens: Number(event.target.value) })}>
              {thresholds.map((each) => <option key={each} value={each}>{formatTokens(each)}</option>)}
            </select>tokens</label>
          <label className="flex items-center gap-1">stop after
            <select aria-label="Idle cutoff" className={select} value={settings.idleHours} disabled={busy} onChange={(event) => set({ idleHours: Number(event.target.value) })}>
              {idles.map((each) => <option key={each} value={each}>{each}</option>)}
            </select>h without a message</label>
          <label className="flex items-center gap-1" title="When warming stops for the idle cutoff, compact the chat once while its cache is still warm">
            <input type="checkbox" checked={settings.compactBeforeExpiry} disabled={busy} aria-label="Compact before the cache expires" onChange={(event) => set({ compactBeforeExpiry: event.target.checked })} />
            then compact before it expires</label>
        </div>
      ) : null}
      {error ? <span role="alert" className="text-destructive">{error}</span> : null}
    </section>
  );
}
