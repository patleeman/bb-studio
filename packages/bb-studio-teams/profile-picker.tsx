import { useCallback, useEffect, useRef, useState } from "react";
import {
  experimental_Icon as Icon,
  useComposer,
  useComposerView,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  useComposerMoreSide,
} from "@bb-studio/kit/app";
import type { Bot, rpcContract } from "./contract";
import { message } from "./bot-ui";
import { SettingsItem } from "./channel-settings";
import { requestChannelHandoff } from "./channel-handoff";

const pendingKey = (projectId: string) => `bb:bots:new-thread-profile:${projectId}`;
const savedPick = (projectId: string) => sessionStorage.getItem(pendingKey(projectId));
const savePick = (projectId: string, botId: string | null) =>
  botId ? sessionStorage.setItem(pendingKey(projectId), botId) : sessionStorage.removeItem(pendingKey(projectId));

/**
 * Beside the composer: the bot this thread works as. Working as a bot, the
 * thread's agent is the bot, in the thread's project with its mission and
 * memory. A thread works as one bot; inviting another hands the thread off
 * to a new channel with both. In the new-thread composer the pick also applies
 * the bot's model and permissions, which can still be changed before sending,
 * and attaches when the first message is sent.
 */
export function ProfilePicker() {
  const [triggerRef, side] = useComposerMoreSide();
  const view = useComposerView();
  const composer = useComposer();
  const rpc = useRpc<typeof rpcContract>();
  const threadId = view.scope.kind === "thread" ? view.scope.threadId : null;
  const projectId = view.scope.kind === "new-thread" ? view.scope.projectId : null;
  const [bots, setBots] = useState<Bot[]>([]);
  // Null until known; false where this thread can't take a profile.
  const [available, setAvailable] = useState<boolean | null>(threadId ? null : true);
  const [botId, setBotId] = useState<string | null>(() => (projectId ? savedPick(projectId) : null));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const loadBots = useCallback(() => {
    rpc.call("profiles", {}).then(setBots, (cause) => setError(message(cause)));
  }, [rpc]);
  useEffect(loadBots, [loadBots]);

  useEffect(() => {
    if (!threadId) return;
    let active = true;
    setAvailable(null);
    rpc.call("threadProfile", { threadId }).then(
      (profile) => {
        if (!active) return;
        setAvailable(!!profile);
        setBotId(profile?.botId ?? null);
      },
      (cause) => active && setError(message(cause)),
    );
    return () => {
      active = false;
    };
  }, [rpc, threadId]);

  // A new-thread pick belongs to the composer's project and survives the
  // composer remounting, for example when its provider changes. The server
  // holds it until the first message; only the shown project's pick is live.
  const pickedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!projectId) return;
    const previous = pickedFor.current;
    pickedFor.current = projectId;
    if (previous && previous !== projectId)
      void rpc.call("pendingThreadProfile", { projectId: previous, botId: null });
    const saved = savedPick(projectId);
    setBotId(saved);
    void rpc.call("pendingThreadProfile", { projectId, botId: saved });
  }, [rpc, projectId]);
  useEffect(() => {
    if (!projectId) return;
    // The server attaches the pick with the first message; start fresh.
    return composer.experimental_onSubmitted(() => {
      savePick(projectId, null);
      setBotId(null);
    });
  }, [composer, projectId]);

  if (available !== true) return null;
  const bot = bots.find((b) => b.id === botId);
  // A saved new-thread pick for a bot that has since been archived lapses.
  const current = threadId ? botId : bot?.id ?? null;
  if (!bots.length && !current) return null;
  const busy = !!threadId && view.run.isRunning;

  const attach = async (next: Bot | null) => {
    setError(null);
    setPending(true);
    try {
      if (threadId) {
        await rpc.call("setThreadProfile", { threadId, botId: next?.id ?? null });
      } else if (projectId) {
        // The bot's model is a starting point; the model picker can still
        // change it without dropping the profile.
        if (next)
          await composer.experimental_setSelection({
            providerId: next.providerId,
            ...(next.model ? { model: next.model } : {}),
            reasoningLevel: next.reasoningLevel,
            permissionMode: next.permissionMode,
          });
        await rpc.call("pendingThreadProfile", { projectId, botId: next?.id ?? null });
        savePick(projectId, next?.id ?? null);
      }
      setBotId(next?.id ?? null);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setPending(false);
    }
  };

  // A thread works as one bot. Another bot means a group: a new channel with
  // both, continuing from this thread or carrying the unsent draft.
  const handoff = (other: Bot) => {
    const memberIds = [...(bot ? [bot.id] : []), other.id];
    if (threadId) {
      requestChannelHandoff(threadId, memberIds);
      return;
    }
    if (projectId) {
      savePick(projectId, null);
      void rpc.call("pendingThreadProfile", { projectId, botId: null });
    }
    requestChannelHandoff(null, memberIds, composer.text);
    composer.setText("");
    setBotId(null);
  };

  const label = bot ? bot.name : current ? "Archived bot" : "Work as bot";
  const others = bots.filter((b) => b.id !== current);
  return (
    <DropdownMenu onOpenChange={(open) => open && loadBots()}>
      <DropdownMenuTrigger asChild>
        <button ref={triggerRef} type="button" className="channel-settings-trigger" disabled={pending}
          data-profile={current ? "" : undefined}
          aria-label={current ? `Working as ${label}` : "Work as a bot"}
          title={error ?? (current ? `Working as ${label}` : "Work as a bot")}>
          {bot?.avatar ? <span aria-hidden="true">{bot.avatar}</span> : <Icon name={current ? "Bot" : "Plus"} />}
          <span>{label}</span>
          <Icon name="ChevronDown" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side={side} align="start" className="w-72">
        {current ? (
          <>
            <DropdownMenuLabel>Working as</DropdownMenuLabel>
            <SettingsItem selected label={bot ? `${bot.avatar ? `${bot.avatar} ` : ""}${bot.name}` : "Archived bot"}
              description={bot?.description || (bot ? `@${bot.handle}` : "Restore it to work as it again")}
              onSelect={() => undefined} />
            <DropdownMenuItem disabled={busy} onSelect={() => void attach(null)}>
              <span className="channel-settings-check"><Icon name="X" /></span>
              <span>{busy ? "Stop working as it after this response" : `Stop working as ${bot?.name ?? "this bot"}`}</span>
            </DropdownMenuItem>
            {others.length ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Invite to a channel</DropdownMenuLabel>
                {others.map((b) => (
                  <BotItem key={b.id} bot={b} onSelect={() => handoff(b)}
                    description={bot ? `New channel with ${bot.name} and ${b.name}` : `New channel with ${b.name}`} />
                ))}
              </>
            ) : null}
          </>
        ) : (
          <>
            <DropdownMenuLabel>Work as a bot</DropdownMenuLabel>
            {busy ? (
              <DropdownMenuItem disabled>Work as a bot after this response</DropdownMenuItem>
            ) : null}
            {bots.map((b) => (
              <BotItem key={b.id} bot={b} disabled={busy} onSelect={() => void attach(b)}
                description={b.description || `@${b.handle}`} />
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function BotItem({ bot, description, disabled, onSelect }: {
  bot: Bot;
  description: string;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem disabled={disabled} onSelect={onSelect} className="items-start">
      <span className="channel-settings-check" aria-hidden="true">{bot.avatar || <Icon name="Bot" />}</span>
      <span className="flex min-w-0 flex-col">
        <span>{bot.name}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </span>
    </DropdownMenuItem>
  );
}
