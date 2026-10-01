import { useState } from "react";
import {
  experimental_Icon as Icon,
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
} from "@bb-studio/kit/app";
import type { rpcContract } from "./contract";
import { channelModeDetails, channelModes, channelPermissions, type ChannelMode } from "./channel-provider";
import { useChannelSurface } from "./channel-thread-surfaces";
import { message } from "./bot-ui";

type Permission = (typeof channelPermissions)[number]["permission"];

/**
 * Beside the composer in a channel thread: the channel's chat mode and bot
 * permissions. These are channel settings, saved when picked, so the model
 * picker keeps meaning "model". Renders nothing on other threads.
 */
export function ChannelSettings() {
  const view = useComposerView();
  const threadId = view.scope.kind === "thread" ? view.scope.threadId : null;
  const { surface, load } = useChannelSurface(threadId);
  const rpc = useRpc<typeof rpcContract>();
  const [error, setError] = useState<string | null>(null);
  if (!surface) return null;
  const { room } = surface;
  const mode: ChannelMode = room.responseBehavior ?? "everyone";
  const permission: Permission = room.permissionMode ?? null;
  const permissionLabel = channelPermissions.find((entry) => entry.permission === permission)!.label;
  const save = async (change: { responseBehavior: ChannelMode; rememberDefault: true } | { permissionMode: Permission }) => {
    setError(null);
    try {
      await rpc.call("channelState", { id: room.id, ...change });
      load();
    } catch (cause) {
      setError(message(cause));
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="channel-settings-trigger" aria-label="Channel mode and bot permissions"
          title={error ?? "Channel mode and bot permissions"}>
          <Icon name="Users" />
          <span>{channelModeDetails[mode].label} · {permissionLabel}</span>
          <Icon name="ChevronDown" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>Who answers</DropdownMenuLabel>
        {channelModes.map((id) => (
          <SettingsItem key={id} selected={id === mode} label={channelModeDetails[id].label}
            description={channelModeDetails[id].description}
            onSelect={() => void save({ responseBehavior: id, rememberDefault: true })} />
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Bot permissions</DropdownMenuLabel>
        {channelPermissions.map((entry) => (
          <SettingsItem key={entry.label} selected={entry.permission === permission} label={entry.label}
            description={entry.description}
            onSelect={() => void save({ permissionMode: entry.permission })} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SettingsItem({ selected, label, description, onSelect }: {
  selected: boolean;
  label: string;
  description: string;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem onSelect={onSelect} aria-checked={selected} role="menuitemradio" className="items-start">
      <span className="channel-settings-check">{selected ? <Icon name="Check" /> : null}</span>
      <span className="flex min-w-0 flex-col">
        <span>{label}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </span>
    </DropdownMenuItem>
  );
}
