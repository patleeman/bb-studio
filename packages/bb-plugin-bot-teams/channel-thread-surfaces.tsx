import { useCallback, useEffect, useRef, useState } from "react";
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
import { Button } from "./components/ui/button";
import { ChannelMembersMenu } from "./channel-members";
import { railLive, railRoutingCount } from "./channel-rail";
import { message } from "./bot-ui";
import { attentionReasons } from "./attention-view";
import { ChannelSearch } from "./channel-search";
import { ChannelAutomationsView } from "./channel-automations-view";
import { channelHandoffText, takeChannelThreadHandoff } from "./handoff-draft";

/**
 * A channel is a BB thread. These surfaces add what a channel has that a
 * thread does not: its members in the header and its live work above the
 * composer. The chat mode and bot permissions are the composer's own
 * model picker (see channel-provider.ts). Each renders nothing on ordinary
 * threads.
 */
type Surface = NonNullable<z.output<typeof rpcContract.channelSurface.output>>;

function useChannelSurface(threadId: string | null) {
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
  useRealtime("changed", load);
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
 * Above the composer, like a thread's follow-ups: requests a bot raised for
 * you (acknowledge or snooze them here, or reply in the channel), and who is
 * working on what, with Stop. A channel with no bots yet says how to add one.
 * Renders nothing otherwise.
 */
export function ChannelComposerBanner() {
  const view = useComposerView();
  const threadId = view.scope.kind === "thread" ? view.scope.threadId : null;
  const { surface, load } = useChannelSurface(threadId);
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [stopping, setStopping] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!surface) return null;
  if (!surface.room.memberIds.length)
    return (
      <p className="channel-banner-empty">
        No bots here yet. Type <kbd>@</kbd> and pick a bot to add it to this channel.
      </p>
    );
  const live = railLive(surface.jobs);
  const routing = railRoutingCount(surface.runs);
  const requests = surface.attention;
  if (!live.length && !routing && !requests.length) return null;
  const answer = async (id: string, action: "acknowledge" | "snooze") => {
    setError(null);
    try {
      await rpc.call("attentionUpdate", action === "snooze" ? { id, action, minutes: 60 } : { id, action });
      load();
    } catch (cause) {
      setError(message(cause));
    }
  };
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
  return (
    <div className="channel-banner" role="status" aria-label="Channel work">
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
}

/** Pre-fills a new channel thread's draft with the thread it was handed off from. */
export function ChannelHandoffPrefill() {
  const composer = useComposer();
  const threadId = composer.scope.kind === "thread" ? composer.scope.threadId : null;
  useEffect(() => {
    const source = threadId && takeChannelThreadHandoff(threadId);
    if (!source) return;
    composer.setText(`${channelHandoffText(source)}\n\n${composer.text}`.trimEnd() + "\n\n");
    // Runs once per thread: the saved handoff is consumed on first read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);
  return null;
}
