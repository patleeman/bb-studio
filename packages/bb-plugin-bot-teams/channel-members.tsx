import { useState } from "react";
import {
  experimental_Icon as Icon,
  useBbNavigate,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { Bot, Job, Room, rpcContract } from "./contract";
import { Button } from "./components/ui/button";
import { InvitePicker, Menu, Modal } from "./channel-controls";
import { channelWork } from "./channel-work";
import { ErrorMessage, message } from "./bot-ui";

export function memberState(bot: Bot, jobs: Job[]) {
  const job = channelWork(jobs).find((j) => j.botId === bot.id);
  return job?.status === "running" && job.startedAt
    ? "Working"
    : job
      ? "Waiting"
      : bot.error
        ? "Needs attention"
        : "Idle";
}

const presence = (state: string) => `bot-presence-dot state-${state.toLowerCase().replaceAll(" ", "-")}`;

/** Who is in a channel: an avatar stack that opens the member list, with Add bot at the bottom. */
export function ChannelMembersMenu({
  room,
  bots,
  jobs,
  onChanged,
}: {
  room: Room;
  bots: Bot[];
  jobs: Job[];
  onChanged: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>(),
    navigate = useBbNavigate();
  const [open, setOpen] = useState(false),
    [inviteOpen, setInviteOpen] = useState(false),
    [pending, setPending] = useState(false),
    [failure, setFailure] = useState<string | null>(null);
  const members = bots.filter((b) => room.memberIds.includes(b.id));
  const act = async (fn: () => Promise<unknown>) => {
    setPending(true);
    setFailure(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setFailure(message(e));
    } finally {
      setPending(false);
    }
  };
  const setMember = (botId: string, present: boolean) =>
    void act(async () => {
      await rpc.call("member", { id: room.id, botId, present });
      setOpen(false);
      setInviteOpen(false);
    });
  return (
    <>
      <Menu
        label="Channel members"
        open={open}
        onOpenChange={setOpen}
        trigger={
          <Button
            variant="ghost"
            className="channel-avatar-stack"
            aria-label={`Channel members: ${members.length} ${members.length === 1 ? "bot" : "bots"}`}
          >
            {members.length ? (
              members.slice(0, 4).map((b) => (
                <span className="channel-avatar" key={b.id} title={`${b.name}: ${memberState(b, jobs)}`}>
                  {b.avatar}
                  <i className={presence(memberState(b, jobs))} />
                </span>
              ))
            ) : (
              <Icon name="UserRoundPlus" />
            )}
            {members.length > 4 && (
              <span className="channel-avatar channel-overflow">+{members.length - 4}</span>
            )}
            <span className="channel-member-summary" aria-hidden>
              <Icon name="Bot" />
              {members.length}
            </span>
          </Button>
        }
      >
        <div className="channel-member-list">
          {members.map((b) => (
            <div className="channel-member-row" key={b.id}>
              <span className="channel-avatar" aria-hidden>{b.avatar}</span>
              <span className="channel-bot-name">
                {b.name}
                <small>@{b.handle}</small>
              </span>
              <small>
                <i className={presence(memberState(b, jobs))} /> {memberState(b, jobs)}
              </small>
              <Button
                variant="ghost"
                size="icon"
                className="channel-member-remove text-destructive"
                aria-label={`Remove ${b.name} from channel`}
                disabled={pending || !!room.archived}
                onClick={() => setMember(b.id, false)}
              >
                <Icon name="X" />
              </Button>
              <Menu
                label={`${b.name} options`}
                trigger={
                  <Button variant="ghost" size="icon" aria-label={`${b.name} options`}>
                    <Icon name="MoreHorizontal" />
                  </Button>
                }
              >
                <button
                  className="channel-menu-row"
                  onClick={() => navigate.toPluginPanel("bots", { subPath: `${b.id}/profile` })}
                >
                  Configure bot
                </button>
                <button
                  className="channel-menu-row"
                  disabled={pending || !!room.archived}
                  onClick={() => setMember(b.id, false)}
                >
                  Remove from channel
                </button>
              </Menu>
            </div>
          ))}
        </div>
        {!members.length && <p className="channel-menu-label">No bots in this channel yet.</p>}
        <button
          className="channel-menu-row channel-menu-footer"
          disabled={!!room.archived}
          onClick={() => {
            setOpen(false);
            setInviteOpen(true);
          }}
        >
          <Icon name="Plus" />
          Add bot
        </button>
        <ErrorMessage error={failure} />
      </Menu>
      <Modal title="Add a bot" open={inviteOpen} onOpenChange={setInviteOpen}>
        <InvitePicker
          bots={bots}
          memberIds={room.memberIds}
          onSelect={(b) => setMember(b.id, true)}
          onCreate={() => {
            setInviteOpen(false);
            navigate.toPluginPanel("bots", { subPath: `new/${room.id}` });
          }}
        />
        <ErrorMessage error={failure} />
      </Modal>
    </>
  );
}
