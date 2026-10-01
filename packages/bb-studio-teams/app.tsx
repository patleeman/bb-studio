import { affects } from "./realtime";
import { threadChannelMenu } from "./thread-channel-menu";
import { UsagePanel } from "./channel-workbench";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  useRpc,
  useRealtime,
  useBbNavigate,
  type PluginNavPanelProps,
} from "@get-bb/plugin-sdk/app";
import type {
  Bot,
  BotListItem,
  Conversation,
  Job,
  Room,
  rpcContract,
} from "./contract";
import { AddOnCollection, type ProviderCall } from "@bb-studio/kit/app";
import type { StudioSchemas } from "@bb-studio/kit/contract";
import { Button } from "@bb-studio/kit/ui";
import {
  TabBar,
  ProfileForm,
  DocumentEditor,
  WorkList,
  ErrorMessage,
  message,
} from "./bot-ui";
import {
  ChannelsPage,
  TeamsSidebar,
  ChannelRedirect,
  ChannelLinkNavigation,
} from "./channels";
import { Modal } from "./channel-controls";
import { setThreadDraft } from "./channel-drafts";
import { ChannelSettings } from "./channel-settings";
import { ProfilePicker } from "./profile-picker";
import { ThreadBadges } from "./thread-badges";
import { ProfileThreads } from "./profile-threads";
import { BotCreateRequests } from "./bot-create-requests";
import { BotCreationThread } from "./bot-creation-thread";
import { BOT_KIND, NEW_BOT_EVENT, PLUGIN_ID } from "./studio-provider";
import {
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  FLOATING_BUTTON,
  ICON_BUTTON,
  Icon as KitIcon,
  ItemHeader,
  ItemTile,
  openAppPath,
  PageColumn,
  studioPath,
  useStudioPresent,
} from "@bb-studio/kit/app";
import {
  ChannelHandoffController,
  requestChannelHandoff,
} from "./channel-handoff";
import "./styles.css";
import { botTeamsIcons } from "./icons";
import {
  ChannelComposerBanner,
  ChannelTranscriptWork,
  ChannelHandoffPrefill,
  ChannelThreadHeader,
} from "./channel-thread-surfaces";
const tabs = ["profile", "mission", "memory", "threads", "activity", "usage"] as const;
const STATUS_TONES = {
  ready: "success",
  working: "live",
  paused: "neutral",
  error: "danger",
} as const;

function BotDetail({ id, tab }: { id: string; tab: string }) {
  const rpc = useRpc<typeof rpcContract>(),
    navigate = useBbNavigate(),
    studio = useStudioPresent();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [data, setData] = useState<{
      bot: Bot;
      conversations: Conversation[];
      jobs: Job[];
    } | null>(null),
    [error, setError] = useState<string | null>(null),
    [pending, setPending] = useState(false);
  const request = useRef(0);
  const load = useCallback(() => {
    const seq = ++request.current;
    rpc.call("get", { id }).then(
      (d) => {
        if (seq === request.current) {
          setData(d);
          setError(null);
        }
      },
      (e) => {
        if (seq === request.current) setError(message(e));
      },
    );
  }, [rpc, id]);
  useEffect(() => {
    load();
    return () => {
      request.current++;
    };
  }, [load]);
  useRealtime("scoped-changed", (event) => { if (affects(event, "bots", id)) load(); });
  const action = async (fn: () => Promise<unknown>) => {
    setPending(true);
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError(message(e));
    } finally {
      setPending(false);
    }
  };
  if (!data)
    return (
      <PageColumn>
        <ErrorMessage error={error} />
        <p role="status" className="text-sm text-muted-foreground">Loading bot…</p>
      </PageColumn>
    );
  const { bot, jobs } = data;
  const activeWork = jobs.some((job) =>
    ["queued", "dispatching", "running"].includes(job.status),
  );
  const botStatus = bot.error
    ? "error"
    : activeWork
      ? "working"
      : bot.retired
        ? "paused"
        : "ready";
  const statusLabel = bot.retired
    ? "Archived"
    : bot.error
      ? "Failing"
      : botStatus === "working"
          ? "Working"
          : "Ready";
  const startThread = async () => {
    try {
      const conversation = await rpc.call("newConversation", { id });
      navigate.toThread(conversation.threadId);
    } catch (cause) {
      setError(message(cause));
    }
  };
  return (
    <div className="relative h-full min-h-0">
      <ItemHeader
        backLabel={studio ? "Studio" : "Bots"}
        onBack={() =>
          studio ? openAppPath(studioPath("bot")) : navigate.toPluginPanel("bots")
        }
        leading={<Badge label={statusLabel} tone={STATUS_TONES[botStatus]} />}
        trailing={
          <>
            {bot.retired ? null : (
              <button type="button" className={FLOATING_BUTTON} disabled={pending} onClick={() => void startThread()}>
                <KitIcon name="MessageSquarePlus" /> Message
              </button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label="Bot options" className={ICON_BUTTON}>
                  <KitIcon name="MoreHorizontal" className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem
                  disabled={pending || !!bot.retired}
                  onSelect={() => void action(() => rpc.call("wake", { id }))}
                >
                  <KitIcon name="Zap" className="size-4" /> Wake now
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    bot.retired
                      ? void action(() => rpc.call("retire", { id, retired: false }))
                      : setArchiveOpen(true)
                  }
                >
                  <KitIcon name={bot.retired ? "RotateCcw" : "Archive"} className="size-4" />
                  {bot.retired ? "Restore bot" : "Archive bot"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
      <PageColumn className="flex min-h-full flex-col">
        <div className="flex items-center gap-4 pb-4">
          <ItemTile icon={bot.avatar || null} kindIcon="Bot" size="xl" />
          <div className="min-w-0">
            <h1 className="truncate text-[32px] leading-tight font-semibold tracking-tight max-md:text-[28px]">{bot.name}</h1>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              @{bot.handle}
              {bot.description ? ` · ${bot.description}` : ""}
            </p>
          </div>
        </div>
        <TabBar
          items={tabs}
          selected={tab}
          label="Bot sections"
          onSelect={(t) =>
            navigate.toPluginPanel("bots", { subPath: `${id}/${t}` })
          }
        />
        <Modal
          title={`Archive ${bot.name}?`}
          open={archiveOpen}
          onOpenChange={setArchiveOpen}
        >
          <p className="text-sm leading-5">
            This stops the bot’s work and removes it from every channel. Its
            profile, mission, memory, files, and conversation history are
            preserved. You can restore it later.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => setArchiveOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={pending}
              onClick={() =>
                action(async () => {
                  await rpc.call("retire", { id, retired: true });
                  setArchiveOpen(false);
                })
              }
            >
              Archive bot
            </Button>
          </div>
          <ErrorMessage error={error} />
        </Modal>
        {(error || bot.error) && (
          <div className="mt-4">
            <ErrorMessage error={error || bot.error} />
          </div>
        )}
        <div className="mt-5 flex flex-1 flex-col">
          {tab === "profile" && (
            <ProfileForm
              key={bot.id}
              bot={bot}
              onSaved={load}
              onArchive={() => {
                if (bot.retired) {
                  void action(() => rpc.call("retire", { id, retired: false }));
                } else {
                  setArchiveOpen(true);
                }
              }}
            />
          )}
          {(tab === "mission" || tab === "memory") && (
            <DocumentEditor
              key={`${id}/${tab}`}
              bot={bot}
              file={tab === "mission" ? "MISSION.md" : "MEMORY.md"}
            />
          )}
          {tab === "threads" && <ProfileThreads id={id} />}
          {tab === "usage" && <UsagePanel id={id} kind="bot" />}
          {tab === "activity" && (
            <>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm font-medium text-muted-foreground">
                  Activity
                </h2>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending || bot.retired}
                  onClick={() => action(() => rpc.call("wake", { id }))}
                >
                  Wake now
                </Button>
              </div>
              <WorkList jobs={jobs} bots={[bot]} />
            </>
          )}
        </div>
      </PageColumn>
    </div>
  );
}
function BotsPage({ subPath }: PluginNavPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [data, setData] = useState<{
      bots: BotListItem[];
      rooms: Room[];
      botCreateRequests: import("./contract").BotCreateRequestView[];
    } | null>(null),
    [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const load = useCallback(() => {
    const seq = ++request.current;
    rpc.call("list").then(
      (r) => {
        if (seq === request.current) {
          setData(r);
          setError(null);
        }
      },
      (e) => {
        if (seq === request.current) setError(message(e));
      },
    );
  }, [rpc]);
  useEffect(() => {
    load();
    return () => {
      request.current++;
    };
  }, [load]);
  useRealtime("scoped-changed", (event) => { if (affects(event, "bots")) load(); });
  const [id, section] = subPath.split("/");
  if (id === "new")
    return <BotCreationThread key={section ?? "standalone"} roomId={section} />;
  if (id === "new-group" || id === "group")
    return <ChannelRedirect subPath={id === "group" ? section : "new"} />;
  if (id)
    return (
      <BotDetail
          key={id}
          id={id}
          tab={
            tabs.includes(section as (typeof tabs)[number])
              ? section
              : "profile"
          }
        />
    );
  return <BotList requests={data?.botCreateRequests ?? null} error={error} onResolved={load} />;
}
/**
 * The bots as a Studio collection, like every add-on's page. With Studio
 * installed it hands over to Studio's, except while bot creation requests,
 * which Studio can't show, are waiting.
 */
function BotList({
  requests,
  error,
  onResolved,
}: {
  requests: import("./contract").BotCreateRequestView[] | null;
  error: string | null;
  onResolved: () => void;
}) {
  const rpc = useRpc<StudioSchemas["provider"]>();
  const call = useCallback<ProviderCall>((method, input) => rpc.call(method, input as never) as never, [rpc]);
  const [version, setVersion] = useState(0);
  useRealtime("scoped-changed", (event) => { if (affects(event, "bots")) setVersion((value) => value + 1); });
  if (requests === null && !error) return null;
  return (
    <div className="flex h-full flex-col">
      {requests?.length ? (
        <div className="mx-10 mt-6 max-md:mx-4">
          <BotCreateRequests botCreateRequests={requests} onBotCreateRequestResolved={onResolved} />
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        <AddOnCollection pluginId={PLUGIN_ID} title="Bots" kind={BOT_KIND.id} call={call} refreshKey={version} handOver={!requests?.length} />
      </div>
    </div>
  );
}
/** Studio's New ▾ → Bot opens the bot setup chat. */
function NewBotListener() {
  const navigate = useBbNavigate();
  useEffect(() => {
    const open = () => navigate.toPluginPanel("bots", { subPath: "new" });
    window.addEventListener(NEW_BOT_EVENT, open);
    return () => window.removeEventListener(NEW_BOT_EVENT, open);
  }, [navigate]);
  return null;
}
export default definePluginApp((app) => {
  for (const icon of botTeamsIcons) app.experimental_icons.register(icon);
  app.contentScripts.register(threadChannelMenu);
  app.slots.experimental_appOverlay({
    id: "channel-links",
    component: ChannelLinkNavigation,
  });
  app.slots.experimental_appOverlay({
    id: "channel-handoff",
    component: ChannelHandoffController,
  });
  app.composer.customize({
    id: "channel-handoff",
    scopes: ["thread"],
    plusMenu: [
      {
        id: "new-channel",
        label: "Handoff to new channel",
        icon: "MessageSquarePlus",
        description: "Open a new channel with a reference to this thread.",
        run: ({ view }) => {
          if (view.scope.kind === "thread")
            requestChannelHandoff(view.scope.threadId);
        },
      },
    ],
  });
  app.slots.experimental_threadHeaderAction({
    id: "channel-members",
    title: "Channel",
    component: ChannelThreadHeader,
  });
  app.composer.customize({
    id: "thread-profile",
    scopes: ["thread", "new-thread"],
    actions: [{ id: "profile", component: ProfilePicker }],
  });
  app.composer.customize({
    id: "channel-thread",
    scopes: ["thread"],
    actions: [
      { id: "channel-handoff-prefill", component: ChannelHandoffPrefill },
      { id: "channel-settings", component: ChannelSettings },
    ],
    banners: [
      { id: "channel-work", chrome: "bare", component: ChannelTranscriptWork },
      { id: "channel-requests", component: ChannelComposerBanner },
    ],
    richText: {
      onDraftChange: (draft, view) => {
        if (view.scope.kind === "thread")
          setThreadDraft(view.scope.threadId,
            !!draft.text.trim() || view.draft.attachmentCount > 0);
      },
    },
  });
  app.slots.navPanel({
    id: "bots",
    title: "Teams",
    icon: "Bot",
    path: "bots",
    component: BotsPage,
  });
  app.slots.navPanel({
    id: "channels",
    title: "New channel",
    icon: "MessageSquare",
    path: "channels",
    component: ChannelsPage,
  });
  // Channels, as a section of the Studio Sidebar.
  app.slots.experimental_appOverlay({ id: "sidebar-sections", component: TeamsSidebar });
  app.slots.experimental_appOverlay({ id: "thread-badges", component: ThreadBadges });
  app.slots.experimental_appOverlay({ id: "studio-new-bot", component: NewBotListener });
});
