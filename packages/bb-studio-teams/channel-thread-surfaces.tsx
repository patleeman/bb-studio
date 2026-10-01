import { affects } from "./realtime";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  experimental_Icon as Icon,
  useBbNavigate,
  useComposer,
  useComposerView,
  useRealtime,
  useRpc,
  type PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";
import type { z } from "zod";
import type { rpcContract } from "./contract";
import { Button } from "@bb-studio/kit/ui";
import { ChannelMembersMenu } from "./channel-members";
import { railLive, railRoutingCount } from "./channel-rail";
import { message } from "./bot-ui";
const attentionReasons = { decision: "Decision needed", blocker: "Blocked", update: "Important update" };
import { ChannelSearch } from "./channel-search";
import { ChannelAutomationsView } from "./channel-automations-view";
import { channelHandoffDraft, takeChannelThreadHandoff } from "./handoff-draft";

/**
 * A channel is a BB thread. These surfaces add what a channel has that a
 * thread does not: its members in the header, its live work at the end of
 * the transcript, and its requests for you above the composer. The chat mode
 * and bot permissions sit beside the composer (see channel-settings.tsx).
 * Each renders nothing on ordinary threads.
 */
type Surface = NonNullable<z.output<typeof rpcContract.channelSurface.output>>;

export function useChannelSurface(threadId: string | null) {
  const rpc = useRpc<typeof rpcContract>();
  const [surface, setSurface] = useState<Surface | null>(null);
  const request = useRef(0);
  const load = useCallback(() => {
    const id = ++request.current;
    if (!threadId) {
      setSurface(null);
      return;
    }
    void rpc.call("channelSurface", { threadId }).then(
      (next) => id === request.current && setSurface(next),
      () => id === request.current && setSurface(null),
    );
  }, [rpc, threadId]);
  useEffect(load, [load]);
  useRealtime("scoped-changed", (event) => { if (affects(event, "channel", surface?.room.id)) load(); });
  return { surface, load };
}

/** Header: who is in the channel, search across its history, and its schedules. */
export function ChannelThreadHeader({ threadId }: PluginThreadHeaderActionProps) {
  const { surface, load } = useChannelSurface(threadId);
  const [searchOpen, setSearchOpen] = useState(false);
  const [automationsOpen, setAutomationsOpen] = useState(false);
  if (!surface) return null;
  return (
    <div className="channel-thread-header">
      <ChannelMembersMenu room={surface.room} bots={surface.bots} jobs={surface.jobs} onChanged={load} />
      <Button variant="ghost" size="icon" aria-label="Search channel" onClick={() => setSearchOpen(true)}>
        <Icon name="Search" />
      </Button>
      <ChannelSearch id={surface.room.id} open={searchOpen} onOpenChange={setSearchOpen} />
      <Button variant="ghost" size="icon" aria-label="Channel automations" onClick={() => setAutomationsOpen(true)}>
        <Icon name="Clock" />
      </Button>
      <ChannelAutomationsView
        id={surface.room.id}
        bots={surface.bots.filter((b) => surface.room.memberIds.includes(b.id))}
        open={automationsOpen}
        onOpenChange={setAutomationsOpen}
      />
    </div>
  );
}

/**
 * The end of the transcript in the pane that holds `anchor`. BB has no slot
 * after the last timeline row, so this appends a node to the timeline, the
 * first child of the content column beside the composer footer, and puts it
 * back at the end whenever BB re-renders either. The timeline stretches to
 * the pane's height, so a node after it would sit by the composer instead.
 * BB's bottom anchoring keeps it in view as it grows.
 */
function useTranscriptEnd(anchor: HTMLElement | null) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const scroll = anchor?.closest("[data-scroll-footer]")?.parentElement;
    if (!scroll) return;
    const end = document.createElement("div");
    end.className = "channel-transcript-end";
    const observer = new MutationObserver(() => place());
    const place = () => {
      const column = scroll.firstElementChild;
      if (!column || column.hasAttribute("data-scroll-footer")) return;
      observer.observe(column, { childList: true });
      const timeline = column.firstElementChild;
      if (!timeline || timeline === end) return;
      observer.observe(timeline, { childList: true });
      if (timeline.lastElementChild !== end) timeline.append(end);
    };
    observer.observe(scroll, { childList: true });
    place();
    setNode(end);
    return () => {
      observer.disconnect();
      end.remove();
      setNode(null);
    };
  }, [anchor]);
  return node;
}

/**
 * Who is working on what, with Stop, at the end of the transcript like the
 * thread's own working indicator. Registered as a bare banner: it only
 * anchors the portal, so it must not draw a card above the composer.
 */
export function ChannelTranscriptWork() {
  const view = useComposerView();
  const threadId = view.scope.kind === "thread" ? view.scope.threadId : null;
  const { surface, load } = useChannelSurface(threadId);
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [stopping, setStopping] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const transcriptEnd = useTranscriptEnd(surface ? anchor : null);
  const marker = <span hidden ref={setAnchor} />;
  if (!surface) return null;
  const live = railLive(surface.jobs);
  const routing = railRoutingCount(surface.runs);
  const stop = async (jobId: string) => {
    setStopping(jobId);
    setError(null);
    try {
      await rpc.call("cancelJob", { id: jobId });
      load();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setStopping(null);
    }
  };
  const work = (live.length > 0 || routing > 0) && (
    <div className="channel-banner channel-transcript-work" role="status" aria-label="Channel work">
      {routing > 0 && !live.length && (
        <div className="channel-banner-row">
          <span className="channel-banner-avatar"><Icon name="Loading" /></span>
          <span className="channel-banner-activity">Choosing who answers…</span>
        </div>
      )}
      {live.map((entry) => {
        const bot = surface.bots.find((b) => b.id === entry.botId);
        const name = bot?.name ?? "Bot";
        return (
          <div className="channel-banner-row" key={entry.jobId}>
            <span className="channel-banner-avatar" aria-hidden>{bot?.avatar ?? "🤖"}</span>
            <button
              type="button"
              className="channel-banner-name"
              disabled={!entry.threadId}
              title="Open its work thread"
              onClick={() => entry.threadId && navigate.toThread(entry.threadId)}
            >
              {name}
            </button>
            <span className="channel-banner-activity">
              {entry.running ? entry.activity || "Working…" : "Queued"}
              {entry.queuedBehind > 0 ? ` · ${entry.queuedBehind} waiting` : ""}
            </span>
            {entry.running && (
              <span className="channel-working" role="img" aria-label="Working">
                <Icon name="Loading" />
              </span>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="channel-banner-stop"
              aria-label={`Stop ${name}`}
              disabled={!entry.stoppable || stopping === entry.jobId}
              onClick={() => void stop(entry.jobId)}
            >
              <Icon name="Square" />
            </Button>
          </div>
        );
      })}
      {error && <p role="alert" className="channel-banner-error">{error}</p>}
    </div>
  );
  return (
    <>
      {marker}
      {/* Until the transcript is found, the work shows here instead. */}
      {transcriptEnd ? work && createPortal(work, transcriptEnd) : work}
    </>
  );
}

/**
 * Above the composer, like a thread's follow-ups: requests a bot raised for
 * you (acknowledge or snooze them here, or reply in the channel). A channel
 * with no bots yet says how to add one. Renders nothing otherwise.
 */
export function ChannelComposerBanner() {
  const view = useComposerView();
  const threadId = view.scope.kind === "thread" ? view.scope.threadId : null;
  const { surface, load } = useChannelSurface(threadId);
  const rpc = useRpc<typeof rpcContract>();
  const [error, setError] = useState<string | null>(null);
  if (!surface) return null;
  if (!surface.room.memberIds.length)
    return (
      <p className="channel-banner-empty">
        No bots here yet. Type <kbd>@</kbd> and pick a bot to add it to this channel.
      </p>
    );
  const requests = surface.attention;
  if (!requests.length && !error) return null;
  const answer = async (id: string, action: "acknowledge" | "snooze") => {
    setError(null);
    try {
      await rpc.call("attentionUpdate", action === "snooze" ? { id, action, minutes: 60 } : { id, action });
      load();
    } catch (cause) {
      setError(message(cause));
    }
  };
  return (
    <div className="channel-banner" role="status" aria-label="Channel requests">
      {requests.map((request) => {
        const bot = surface.bots.find((b) => b.id === request.message.botId);
        return (
          <div className="channel-banner-request" key={request.id}>
            <span className="channel-banner-avatar" aria-hidden><Icon name="BellDot" /></span>
            <span className="channel-banner-request-text" title={request.message.text}>
              <strong>{attentionReasons[request.reason]}</strong>
              {bot ? ` from ${bot.name}` : ""}: {request.message.text.replace(/\s+/gu, " ")}
            </span>
            <span className="channel-banner-request-actions">
              <Button variant="ghost" size="sm" onClick={() => void answer(request.id, "acknowledge")}>
                Acknowledge
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void answer(request.id, "snooze")}>
                Snooze 1 hour
              </Button>
            </span>
          </div>
        );
      })}
      {error && <p role="alert" className="channel-banner-error">{error}</p>}
    </div>
  );
}

/** Pre-fills a new channel thread's draft with the thread it was handed off from. */
export function ChannelHandoffPrefill() {
  const composer = useComposer();
  const threadId = composer.scope.kind === "thread" ? composer.scope.threadId : null;
  useEffect(() => {
    const handoff = threadId && takeChannelThreadHandoff(threadId);
    if (!handoff) return;
    composer.setText(channelHandoffDraft(handoff, composer.text));
    // Runs once per thread: the saved handoff is consumed on first read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);
  return null;
}
