// Make a Studio item inside a Space: it goes in the Space's own folder, so it
// belongs to the Space, and opens beside the lead. Shared by the status tab's
// New menu and the "New in Space" tab in the workbench's New tab menu.
import * as Menu from "@radix-ui/react-dropdown-menu";
import { GHOST_BUTTON, Icon } from "@bb-studio/kit/app";
import type { StudioCreateEventDetail } from "@bb-studio/kit/contract";
import { errorMessage } from "@bb-studio/kit/format";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { ProviderView, rpcContract } from "../../contract";
import { useSpaceLead } from "./data";
import { MENU, MENU_ITEM, PORTAL_SCOPE } from "./styles";

export type SpaceKind = ProviderView["kinds"][number] & { pluginId: string; providerName: string };
export interface CreatedItem { href: string; title: string }

// Providers rarely change; one load per session, refreshed when a menu opens.
let cachedKinds: SpaceKind[] | null = null;

function kindsOf(providers: readonly ProviderView[]): SpaceKind[] {
  return providers.filter((provider) => provider.state === "ready").flatMap((provider) =>
    provider.kinds
      .filter((kind) => kind.create && (kind.capabilities?.create ?? true))
      .map((kind) => ({ ...kind, pluginId: provider.pluginId, providerName: provider.name })));
}

/** The kinds of Studio item that can be made, loaded on demand. */
export function useSpaceKinds() {
  const rpc = useRpc<typeof rpcContract>();
  const [kinds, setKinds] = useState<SpaceKind[] | null>(cachedKinds);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    rpc.call("overview", null).then(
      ({ providers }) => { cachedKinds = kindsOf(providers); setKinds(cachedKinds); },
      (cause: unknown) => setError(errorMessage(cause)),
    );
  }, [rpc]);
  return { kinds, error, load };
}

/**
 * Creates one item in the Space. Add-ons that create through their own
 * workflow (a recording, an import) get their event with the Space's folder;
 * those open themselves, so this resolves null.
 */
export function useCreateInSpace(spaceId: string | null) {
  const rpc = useRpc<typeof rpcContract>();
  const lead = useSpaceLead(spaceId);
  return useCallback(async (kind: SpaceKind): Promise<CreatedItem | null> => {
    if (!spaceId) return null;
    if (kind.create?.mode === "event") {
      const event = new CustomEvent<StudioCreateEventDetail>(kind.create.event, { detail: { projectId: lead.data?.defaultProjectId ?? null }, cancelable: true });
      window.dispatchEvent(event);
      if (!event.defaultPrevented) toast.error(`${kind.providerName} isn't loaded yet. Reload BB and try again.`);
      return null;
    }
    try {
      const { href, title } = await rpc.call("createInSpace", { id: spaceId, pluginId: kind.pluginId, kind: kind.id });
      return { href, title: title ?? kind.label };
    } catch (cause) {
      toast.error(`Couldn't create a ${kind.label.toLowerCase()}: ${errorMessage(cause)}`);
      return null;
    }
  }, [lead.data?.defaultProjectId, rpc, spaceId]);
}

/** "New" menu: every kind of Studio item, made in the Space. */
export function NewInSpaceMenu({ spaceId, onCreated, label = "New" }: { spaceId: string; onCreated(item: CreatedItem): void; label?: string }) {
  const { kinds, error, load } = useSpaceKinds();
  const create = useCreateInSpace(spaceId);
  return (
    <Menu.Root onOpenChange={(open) => { if (open) load(); }}>
      <Menu.Trigger className={GHOST_BUTTON} title="New Studio item in this Space"><Icon name="Plus" className="size-4" />{label}</Menu.Trigger>
      <Menu.Portal>
        <Menu.Content {...PORTAL_SCOPE} align="end" className={MENU}>
          {(kinds ?? []).map((kind) => (
            <Menu.Item key={`${kind.pluginId}:${kind.id}`} className={MENU_ITEM} onSelect={() => void create(kind).then((item) => { if (item) onCreated(item); })}>
              <Icon name={kind.icon} />{kind.label}
            </Menu.Item>
          ))}
          {error ? <Menu.Item className={MENU_ITEM} onSelect={(event) => { event.preventDefault(); load(); }} title={error}><Icon name="RefreshCw" />Retry loading</Menu.Item>
            : kinds === null ? <Menu.Item className={MENU_ITEM} disabled>Loading…</Menu.Item>
              : !kinds.length ? <Menu.Item className={MENU_ITEM} disabled>Nothing to create</Menu.Item> : null}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** A full tab of choices, for the workbench's New tab menu. */
export function NewInSpacePicker({ spaceId, spaceName, onCreated }: { spaceId: string; spaceName: string; onCreated(item: CreatedItem): void }) {
  const { kinds, error, load } = useSpaceKinds();
  const create = useCreateInSpace(spaceId);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(load, [load]);
  return (
    <div className="mx-auto w-full max-w-xl px-6 py-8">
      <h1 className="text-lg font-semibold">New in {spaceName}</h1>
      <p className="mt-1 text-sm text-muted-foreground">It's saved in the Space and opens in this tab.</p>
      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {(kinds ?? []).map((kind) => {
          const key = `${kind.pluginId}:${kind.id}`;
          return (
            <button
              key={key}
              type="button"
              disabled={busy !== null}
              onClick={() => { setBusy(key); void create(kind).then((item) => { setBusy(null); if (item) onCreated(item); }); }}
              className="flex min-h-20 flex-col items-start gap-2 rounded-lg border border-border p-3 text-left text-sm hover:bg-state-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60"
            >
              <Icon name={kind.icon} className="size-4 text-muted-foreground" />
              <span className="font-medium">{busy === key ? "Creating…" : kind.label}</span>
            </button>
          );
        })}
      </div>
      {kinds === null && !error ? <p role="status" className="mt-4 text-sm text-muted-foreground">Loading…</p> : null}
      {kinds && !kinds.length ? <p className="mt-4 text-sm text-muted-foreground">No Studio add-on can create items right now.</p> : null}
      {error ? <p role="alert" className="mt-4 text-sm text-destructive">Couldn't load item types. <button type="button" onClick={load} className="underline">Retry</button></p> : null}
    </div>
  );
}
