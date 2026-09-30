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
import { Button } from "./components/ui/button";
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
import { BotCollection } from "./bot-collection";
import { BotCreationThread } from "./bot-creation-thread";
import { NEW_BOT_EVENT } from "./studio-provider";
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
  ChannelHandoffPrefill,
  ChannelThreadHeader,
} from "./channel-thread-surfaces";
const tabs = ["profile", "mission", "memory", "activity", "usage"] as const;
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
  useRealtime("changed", load);
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
      <div className="bot-page">
        <ErrorMessage error={error} />
        <p role="status">Loading bot…</p>
      </div>
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
    <div className="bot-detail relative">
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
      <div className="bot-hero">
        <ItemTile icon={bot.avatar || null} kindIcon="Bot" size="xl" />
        <div className="min-w-0">
          <h1>{bot.name}</h1>
          <p>
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
        <div className="bot-error">
          <ErrorMessage error={error || bot.error} />
        </div>
      )}
      {
        <div className="bot-section">
          <div className="bot-config-content">
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
                <div className="bot-activity-panel">
                  <WorkList jobs={jobs} bots={[bot]} />
                </div>
              </>
            )}
          </div>
        </div>
      }
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
  useRealtime("changed", load);
  const [id, section] = subPath.split("/");
  const bots = data?.bots ?? [];
  if (id === "new")
    return <BotCreationThread key={section ?? "standalone"} roomId={section} />;
  if (id === "new-group" || id === "group")
    return <ChannelRedirect subPath={id === "group" ? section : "new"} />;
  if (id)
    return (
      <div className="bot-route">
        <BotDetail
          key={id}
          id={id}
          tab={
            tabs.includes(section as (typeof tabs)[number])
              ? section
              : "profile"
          }
        />
      </div>
    );
  return (
    <BotCollection
      bots={bots}
      loading={!data}
      error={error}
      botCreateRequests={data?.botCreateRequests ?? []}
      onBotCreateRequestResolved={load}
    />
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
    id: "channel-thread",
    scopes: ["thread"],
    actions: [
      { id: "channel-handoff-prefill", component: ChannelHandoffPrefill },
    ],
    banners: [{ id: "channel-work", component: ChannelComposerBanner }],
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
    title: "Studio Teams",
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
  // Channels and Direct messages, as sections of the Studio Sidebar.
  app.slots.experimental_appOverlay({ id: "sidebar-sections", component: TeamsSidebar });
  app.slots.experimental_appOverlay({ id: "studio-new-bot", component: NewBotListener });
});
