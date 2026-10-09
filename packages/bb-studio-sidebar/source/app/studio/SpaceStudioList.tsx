import { errorMessage } from "@bb-studio/kit/format";
import { useCallback, useState } from "react";
import { createStudioItem, openAppPath, openPathInSplit, openWorkspaceItem } from "@bb-studio/kit/app";
import { toast } from "sonner";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SIDEBAR_CONTROL_BUTTON_CLASS } from "../rows/sidebarRowClasses.js";
import type { SpaceBrowseItem, SpaceItems } from "./studioSpaces.js";

/**
 * Opens a Studio item in the main area, in place of the current pane, or in
 * a split beside it with `split` (⌘/Ctrl-click) when BB will split.
 * `anchor` is a link this plugin renders; BB splits a Mod-click on one.
 */
export function openStudioItem(anchor: HTMLAnchorElement | null, href: string, split = false): void {
  if (split) {
    try {
      if (openPathInSplit(anchor, href)) return;
    } catch {
      // No split here; open in place.
    }
  }
  openAppPath(href);
}

const kindSchema = z.object({
  id: z.string(),
  label: z.string(),
  icon: z.string().catch("File"),
  create: z.union([z.object({ mode: z.literal("rpc") }), z.object({ mode: z.literal("event"), event: z.string() }), z.null()]).catch(null),
  capabilities: z.object({ create: z.boolean().optional() }).passthrough().optional().catch(undefined),
}).passthrough();
const overviewSchema = z.object({
  providers: z.array(z.object({ pluginId: z.string(), name: z.string(), state: z.string(), kinds: z.array(kindSchema).catch([]) }).passthrough()),
}).passthrough();
const createdSchema = z.object({ href: z.string(), title: z.string().optional() });
const projectSchema = z.object({ projectId: z.string() });

type Kind = z.infer<typeof kindSchema> & { pluginId: string; providerName: string };

/** A new thread, then every kind of Studio item, made in the Space's folder, from +. */
function NewItemMenu({ spaceId, spaceName, defaultProjectId, onCreated, onNewThread }: {
  spaceId: string;
  spaceName: string;
  defaultProjectId: string | null;
  onCreated(href: string): void;
  onNewThread(): void;
}) {
  const sdk = useSdk();
  const [kinds, setKinds] = useState<Kind[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Parsed here, so a malformed answer lands in the error path instead of throwing in a then.
  const call = useCallback(async <T,>(method: string, input: unknown, outputSchema: z.ZodType<T>): Promise<T> =>
    outputSchema.parse(await sdk.plugins.callRpc({ pluginId: "studio", method, input: input as never, outputSchema, signal: AbortSignal.timeout(15_000) })), [sdk]);
  const load = () => {
    setError(null);
    call("overview", null, overviewSchema).then(
      ({ providers }) => setKinds(providers.filter((provider) => provider.state === "ready").flatMap((provider) =>
        provider.kinds.filter((kind) => kind.create && (kind.capabilities?.create ?? true)).map((kind) => ({ ...kind, pluginId: provider.pluginId, providerName: provider.name })))),
      (cause: unknown) => setError(errorMessage(cause)),
    );
  };
  const create = async (kind: Kind) => {
    // An item the add-on makes in the browser needs the Space's project up front.
    let projectId = defaultProjectId;
    if (kind.create?.mode === "event" && !projectId) {
      try {
        ({ projectId } = await call("spaceProject", { id: spaceId }, projectSchema));
      } catch (cause) {
        toast.error(`Couldn't create a ${kind.label.toLowerCase()}: ${errorMessage(cause)}`);
        return;
      }
    }
    await createStudioItem(kind, {
      projectId,
      addOn: kind.providerName,
      create: async () => (await call("createInSpace", { id: spaceId, pluginId: kind.pluginId, kind: kind.id }, createdSchema)).href,
      open: onCreated,
    });
  };
  return (
    <DropdownMenu onOpenChange={(open) => { if (open) load(); }}>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={`New in ${spaceName}`} title="New thread or item" className={cn(SIDEBAR_CONTROL_BUTTON_CLASS, "inline-flex items-center justify-center")} onClick={(event) => event.stopPropagation()}>
          <Icon name="Plus" className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48" aria-label={`New in ${spaceName}`}>
        <DropdownMenuItem onSelect={onNewThread}>
          <Icon name="MessageSquarePlus" className="size-4" />Thread
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {(kinds ?? []).map((kind) => (
          <DropdownMenuItem key={`${kind.pluginId}:${kind.id}`} onSelect={() => void create(kind)}>
            <Icon name={kind.icon} className="size-4" />{kind.label}
          </DropdownMenuItem>
        ))}
        {error ? <DropdownMenuItem onSelect={(event) => { event.preventDefault(); load(); }} title={error}><Icon name="RotateCcw" className="size-4" />Retry</DropdownMenuItem>
          : kinds === null ? <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
            : !kinds.length ? <DropdownMenuItem disabled>Nothing to create</DropdownMenuItem> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Opens an item picked or made from a Space's menus: a tab in Studio's workspace, else its own page. */
export function useOpenInSpace(): (href: string) => void {
  const sdk = useSdk();
  return (href) => {
    if (openWorkspaceItem({ href })) return;
    openStudioItem(null, href);
    void sdk.plugins.callRpc({ pluginId: "studio", method: "visitTab", input: { path: href } as never, outputSchema: z.unknown(), signal: AbortSignal.timeout(15_000) }).catch(() => {});
  };
}

/** The Space's items, to open one from the heading's Browse menu. Open ones live in Studio's tabs, not the sidebar. */
export function browsableItems(items: SpaceItems | undefined): SpaceBrowseItem[] {
  return items?.all ?? [];
}

/** The Space heading's +: a new thread, or any kind of Studio item, made in the Space. */
export function SpaceNewMenu({ spaceId, spaceName, defaultProjectId, onNewThread }: {
  spaceId: string;
  spaceName: string;
  defaultProjectId: string | null;
  onNewThread(): void;
}) {
  const openPicked = useOpenInSpace();
  return <NewItemMenu spaceId={spaceId} spaceName={spaceName} defaultProjectId={defaultProjectId} onCreated={openPicked} onNewThread={onNewThread} />;
}
