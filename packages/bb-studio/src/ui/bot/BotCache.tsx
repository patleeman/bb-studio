// A Bot chat's prompt cache on the desktop (src/bot-cache.ts): its segment
// in the chat's context row (minutes left; open for details and actions),
// the composer's cold-send banner, and the Prompt cache section of Bot info.
// On a BB whose context popover takes plugin rows (the card behind the
// context ring under the composer), the details are a "Prompt cache" row
// there and the chip only opens that card; Studio draws no popover of its own.
import { GHOST_BUTTON } from "../../kit/app/index";
import { errorMessage } from "../../kit/format";
import { Icon, Popover, PopoverContent, PopoverTrigger } from "../../kit/ui/index";
import { useBbContext, useComposer } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { registerContextCardRow, useHostContextCard, type ContextCardRow } from "../../kit/app/host-sdk";
import type { BotCacheStateView } from "../../contract";
import { formatTokens, formatUsd } from "../../bot-cache-format";
import { useCall, useLive, type Method, type RpcInput } from "../live";

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

type CacheIndicator = { text: string | null; label: string; tone: "normal" | "amber" | "dim" };

/** Compact status for the thread header; the chip stays quiet when warming is off. */
export function cacheIndicator(state: BotCacheStateView, now = Date.now()): CacheIndicator {
  if (state.state === "off") return { text: null, label: "Prompt cache: Warming off", tone: "dim" };
  if (state.state === "cold" || state.warmUntil == null || state.warmUntil <= now) {
    return { text: "cold", label: "Prompt cache: cold", tone: "dim" };
  }
  const remaining = state.warmUntil - now;
  const minutes = Math.max(1, Math.ceil(remaining / 60_000));
  return {
    text: `${minutes}m`,
    label: `Prompt cache: ${minutes}m left`,
    tone: remaining < 10 * 60_000 ? "amber" : "normal",
  };
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

/** The state in a couple of words, for the row in BB's context popover: "warm 58m", "warming", "cold" or "off". */
export function cacheRowValue(state: BotCacheStateView, now = Date.now()): string {
  if (state.state === "off") return "off";
  if (state.state === "warm" && state.warmUntil != null && state.warmUntil > now) return `warm ${Math.max(1, Math.ceil((state.warmUntil - now) / 60_000))}m`;
  return state.warming.active ? "warming" : "cold";
}

/** The row's quiet line: the Bot's state when that is why nothing is warmed, then what the cache costs. */
export function cacheRowNote(state: BotCacheStateView): string | undefined {
  const bot = /\bBot is (paused|stopped)\b/.exec(state.warming.reason ?? "");
  const parts = [bot ? `Bot ${bot[1]}` : null, costLine(state)].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

const COMPACT_CONFIRM = "Compact this chat?";

/** The "Prompt cache" row for a Bot chat, with the actions the popover had. */
export function cacheRow(state: BotCacheStateView, act: ReturnType<typeof useBotCache>["act"], now = Date.now()): ContextCardRow {
  const note = cacheRowNote(state);
  return {
    label: "Prompt cache",
    value: cacheRowValue(state, now),
    ...(note ? { note } : {}),
    actions: [
      { id: "warming", label: state.settings.enabled ? "Turn warming off" : "Turn warming on", run: () => act("bot_cache_set", { botId: state.botId ?? undefined, enabled: !state.settings.enabled }) },
      { id: "compact", label: "Compact now", run: () => { if (confirm(COMPACT_CONFIRM)) act("bot_cache_compact", { threadId: state.threadId }); } },
    ],
  };
}

/** The row hook BB calls while its context popover is shown: null on a thread that isn't a Bot's chat. */
export function useCacheRow(): ContextCardRow | null {
  const { threadId } = useBbContext();
  const { state, error, act } = useBotCache(threadId ?? null);
  useEffect(() => { if (error) toast.error(error); }, [error]);
  return state ? cacheRow(state, act) : null;
}

let hostCardRow = false;

/** Whether the cache's details live in BB's context popover (registerCacheCardRow), not in a popover of Studio's. */
export const cacheInHostCard = () => hostCardRow && useHostContextCard !== null;

/** Adds the "Prompt cache" row to BB's context popover; false on a BB without the slot, where the chip keeps its own popover. */
export function registerCacheCardRow(slots: object): boolean {
  hostCardRow = registerContextCardRow(slots, { id: "prompt-cache", useRow: useCacheRow });
  return hostCardRow;
}

/** A Bot chat's cache state, polled, with its two actions (warming on/off, Compact now). */
export function useBotCache(threadId: string | null) {
  const live = useLive("bot_cache_state", { threadId: threadId ?? "" }, { enabled: !!threadId, pollMs: POLL_MS });
  const call = useCall();
  const [error, setError] = useState<string | null>(null);
  useTick(30_000);
  const state = live.data;
  const act = <M extends Method,>(method: M, input: RpcInput<M>) => { setError(null); void call(method, input).then(() => live.refresh(), (cause: unknown) => setError(errorMessage(cause))); };
  return { state: state?.botId ? state : null, error, act };
}

const toneClass = (tone: CacheIndicator["tone"]) => tone === "amber" ? "text-warning" : tone === "dim" ? "text-muted-foreground/40" : "text-muted-foreground";

/**
 * The prompt cache in a Bot chat's context row (above the composer): a clock
 * and the minutes left; a click shows the details below the row. Nothing on
 * other threads (the segment's useVisible hides it).
 */
export function BotCacheSummary({ threadId, isExpanded, onToggle }: { threadId: string; isExpanded: boolean; onToggle(): void }) {
  const { state } = useBotCache(threadId);
  if (!state) return null;
  const indicator = cacheIndicator(state);
  return (
    <button type="button" data-testid="bot-cache-chip" aria-label={indicator.label} title={indicator.label} aria-expanded={isExpanded} onClick={onToggle}
      className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs outline-none hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-state-active">
      <ChipFace indicator={indicator} />
    </button>
  );
}

const CHIP = "inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs";

/** The footer chip's words: "cache 59m", "cache cold", "cache off" (UX review 2, item 10). */
export function chipText(indicator: CacheIndicator): string {
  return `cache ${indicator.text ?? "off"}`;
}

function ChipFace({ indicator }: { indicator: CacheIndicator }) {
  return (
    <>
      <Icon name="Clock" className={`size-3.5 ${toneClass(indicator.tone)}`} aria-hidden />
      <span className={`tabular-nums ${indicator.tone === "amber" ? "text-warning" : "text-muted-foreground"}`}>{chipText(indicator)}</span>
    </>
  );
}

/**
 * The composer footer's chip: the clock and the time left. Where BB's
 * context popover has the "Prompt cache" row, a click (or Enter) opens that
 * card; before the thread has a context ring there is no card to open, so
 * the chip is plain text whose tooltip says the state. Elsewhere it keeps
 * Studio's own popover.
 */
export function BotCacheChip({ threadId }: { threadId: string }) {
  return cacheInHostCard() ? <HostCardChip threadId={threadId} /> : <BotCachePopover threadId={threadId} />;
}

function HostCardChip({ threadId }: { threadId: string }) {
  const { state } = useBotCache(threadId);
  const card = useHostContextCard!();
  if (!state) return null;
  const indicator = cacheIndicator(state);
  if (!card.available) return <span data-testid="bot-cache-chip" aria-label={indicator.label} title={indicator.label} className={CHIP}><ChipFace indicator={indicator} /></span>;
  return (
    <button type="button" data-testid="bot-cache-chip" aria-label={`${indicator.label}. Show details`} title={indicator.label} onClick={() => card.open()}
      className={`${CHIP} outline-none hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring`}>
      <ChipFace indicator={indicator} />
    </button>
  );
}

/**
 * The cache details as a small popover on the composer footer's chip: the
 * status, what it costs, and the two actions. Closes on an outside click or
 * Escape, like BB's other popovers.
 */
export function BotCachePopover({ threadId }: { threadId: string }) {
  const { state, error, act } = useBotCache(threadId);
  const [open, setOpen] = useState(false);
  if (!state) return null;
  const indicator = cacheIndicator(state);
  const cost = costLine(state);
  const next = state.warming.active && state.warming.nextPingAt ? `Next keep-alive ping around ${clock(state.warming.nextPingAt)}.`
    : state.warming.compactAt ? `Compacts around ${clock(state.warming.compactAt)}.`
    : state.warming.lastCompactAt ? `Compacted at ${clock(state.warming.lastCompactAt)}.` : null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" data-testid="bot-cache-chip" aria-label={indicator.label} title={indicator.label}
          className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs outline-none hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-state-active">
          <ChipFace indicator={indicator} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" aria-label="Prompt cache" data-testid="bot-cache-popover" style={{ width: 280 }} className="flex max-w-[calc(100vw-2rem)] flex-col gap-2 p-3 text-xs">
        <p className="text-sm font-medium text-foreground">Prompt cache: {indicator.text ?? "Warming off"}</p>
        {state.warming.reason || next ? <p className="text-muted-foreground">{[state.warming.reason ? `${state.warming.reason}.` : null, next].filter(Boolean).join(" ")}</p> : null}
        {cost ? <p className="tabular-nums text-muted-foreground">{cost}</p> : null}
        {error ? <p role="alert" className="text-destructive">{error}</p> : null}
        <div className="flex flex-wrap gap-1 pt-1">
          <button type="button" className={`${GHOST_BUTTON} h-7 text-xs`} onClick={() => act("bot_cache_set", { botId: state.botId ?? undefined, enabled: !state.settings.enabled })}>
            <Icon name={state.settings.enabled ? "Pause" : "Play"} className="size-3.5" />{state.settings.enabled ? "Turn warming off" : "Turn warming on"}
          </button>
          <button type="button" className={`${GHOST_BUTTON} h-7 text-xs`} onClick={() => { if (confirm(COMPACT_CONFIRM)) { act("bot_cache_compact", { threadId }); setOpen(false); } }}>
            <Icon name="Minimize2" className="size-3.5" />Compact now…
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Below the context row while the cache segment is open: why, what's next, the cost, and the two actions. */
export function BotCacheDetails({ threadId, isExpanded }: { threadId: string; isExpanded: boolean }) {
  const { state, error, act } = useBotCache(threadId);
  if (!isExpanded || !state) return null;
  const indicator = cacheIndicator(state);
  const cost = costLine(state);
  return (
    <div data-testid="bot-cache-details" className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">Prompt cache: {indicator.text ?? "Warming off"}</span>
      {state.warming.reason ? <span>{state.warming.reason}.</span> : null}
      {state.warming.active && state.warming.nextPingAt ? <span>Next keep-alive ping around {clock(state.warming.nextPingAt)}.</span> : null}
      {state.warming.compactAt ? <span>Compacts around {clock(state.warming.compactAt)}.</span> : state.warming.lastCompactAt ? <span>Compacted at {clock(state.warming.lastCompactAt)}.</span> : null}
      {cost ? <span>{cost}</span> : null}
      {error ? <span role="alert" className="text-destructive">{error}</span> : null}
      <span className="ml-auto flex gap-1">
        <button type="button" className={GHOST_BUTTON} onClick={() => act("bot_cache_set", { botId: state.botId ?? undefined, enabled: !state.settings.enabled })}>
          <Icon name={state.settings.enabled ? "Pause" : "Play"} />{state.settings.enabled ? "Turn warming off" : "Turn warming on"}
        </button>
        <button type="button" className={GHOST_BUTTON} onClick={() => { if (confirm(COMPACT_CONFIRM)) act("bot_cache_compact", { threadId }); }}>
          <Icon name="Minimize2" />Compact now…
        </button>
      </span>
    </div>
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
  const live = useLive("bot_cache_state", { threadId }, { pollMs: POLL_MS });
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
/** `heading` false: Controls names the section. */
export function BotCacheSection({ botId, threadId, heading = true }: { botId: string; threadId: string | null; heading?: boolean }) {
  const live = useLive("bot_cache_state", { botId }, { pollMs: POLL_MS });
  const call = useCall();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useTick(30_000);
  const state = live.data;
  if (!threadId || !state?.botId) return null;
  const run = async <M extends Method,>(method: M, input: RpcInput<M>) => {
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
        {heading ? <span className="font-medium text-foreground">Prompt cache</span> : null}
        <span className="text-muted-foreground">{cacheLabel(state)}</span>
        <span className="flex-1" />
        <button type="button" className={GHOST_BUTTON} disabled={busy} onClick={() => { if (confirm(COMPACT_CONFIRM)) void run("bot_cache_compact", { threadId }); }}>Compact</button>
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
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={settings.compactBeforeExpiry} disabled={busy} aria-label="Compact before the cache expires" onChange={(event) => set({ compactBeforeExpiry: event.target.checked })} />
            then compact before it expires</label>
        </div>
      ) : null}
      {error ? <span role="alert" className="text-destructive">{error}</span> : null}
    </section>
  );
}
