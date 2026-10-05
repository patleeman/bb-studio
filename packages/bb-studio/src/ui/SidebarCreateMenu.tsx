import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Icon, openAppPath } from "@bb-studio/kit/app";
import { type StudioCreateEventDetail } from "@bb-studio/kit/contract";
import { errorMessage } from "@bb-studio/kit/format";
import { useBbContext, useRpc } from "@get-bb/plugin-sdk/app";
import { useState } from "react";
import { toast } from "sonner";
import type { ProviderView, rpcContract } from "../contract";

type Target = ProviderView["kinds"][number] & { pluginId: string; providerName: string };

/** Create from the sidebar in the project BB has open, using each add-on's workflow. */
export function SidebarCreateMenu({ onNavigate }: { onNavigate(): void }) {
  const rpc = useRpc<typeof rpcContract>();
  const context = useBbContext();
  const [providers, setProviders] = useState<ProviderView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    setError(null);
    void rpc.call("overview", null).then(
      ({ providers }) => setProviders(providers),
      (cause: unknown) => setError(errorMessage(cause)),
    );
  };
  const targets: Target[] = (providers ?? []).filter((provider) => provider.state === "ready").flatMap((provider) =>
    provider.kinds.filter((kind) => kind.create && (kind.capabilities?.create ?? true)).map((kind) => ({ ...kind, pluginId: provider.pluginId, providerName: provider.name })),
  );
  const create = async (target: Target) => {
    const projectId = context.projectId ?? null;
    if (target.create?.mode === "event") {
      const event = new CustomEvent<StudioCreateEventDetail>(target.create.event, { detail: { projectId }, cancelable: true });
      window.dispatchEvent(event);
      if (event.defaultPrevented) onNavigate();
      else toast.error(`${target.providerName} isn't loaded yet. Reload BB and try again.`);
      return;
    }
    try {
      const { item } = await rpc.call("create", { pluginId: target.pluginId, kind: target.id, projectId });
      openAppPath(item.href);
      onNavigate();
    } catch (cause) {
      toast.error(`Couldn't create a ${target.label.toLowerCase()}: ${errorMessage(cause)}`);
    }
  };
  return (
    <DropdownMenu onOpenChange={(open) => { if (open) load(); }}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="New Studio item"
          title="New Studio item"
          className="relative inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-subtle-foreground outline-none hover:bg-state-hover hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[state=open]:bg-state-active data-[state=open]:text-muted-foreground max-md:pointer-coarse:size-9"
        >
          <Icon name="Plus" aria-hidden className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" aria-label="New Studio item" className="w-48">
        {targets.map((target) => (
          <DropdownMenuItem key={`${target.pluginId}:${target.id}`} onSelect={() => void create(target)}>
            <Icon name={target.icon} aria-hidden className="size-4" /> {target.label}
          </DropdownMenuItem>
        ))}
        {error ? <DropdownMenuItem onSelect={(event) => { event.preventDefault(); load(); }} title={error}><Icon name="RotateCcw" /> Retry loading items</DropdownMenuItem>
          : providers === null ? <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
            : !targets.length ? <DropdownMenuItem disabled>No items available to create</DropdownMenuItem> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
