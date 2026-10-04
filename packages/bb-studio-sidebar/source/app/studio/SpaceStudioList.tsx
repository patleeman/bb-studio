import { useCallback, useState, type ReactNode } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { COARSE_POINTER_ROW_HEIGHT_CLASS } from "@/components/ui/coarse-pointer-sizing";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SIDEBAR_CONTROL_BUTTON_CLASS,
  SIDEBAR_GROUP_TEXT_CLASS,
  SIDEBAR_ROW_BASE_CLASS,
  SIDEBAR_ROW_GLYPH_SLOT_CLASS,
  SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
} from "../rows/sidebarRowClasses.js";
import type { OpenInSpaceRequest } from "./openInSpace.js";
import type { SpaceItems } from "./studioSpaces.js";

/** "Studio" or "Threads" inside a Space, with its own + on hover; a title with `onOpen` opens its view. */
export function SpaceSubheading({ title, count, action, onOpen, openLabel }: { title: string; count?: number; action?: ReactNode; onOpen?(): void; openLabel?: string }) {
  const label = <>{title}{count ? <span className="ml-1.5 tabular-nums opacity-70">{count}</span> : null}</>;
  return (
    <div className={cn("group/sub flex h-7 items-center gap-1 pr-0.5 pl-2 text-xs", SIDEBAR_GROUP_TEXT_CLASS)}>
      {onOpen
        ? <span className="min-w-0 flex-1 truncate"><button type="button" onClick={onOpen} aria-label={openLabel} title={openLabel} className="max-w-full truncate rounded-sm text-left hover:text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{label}</button></span>
        : <span className="min-w-0 flex-1 truncate">{label}</span>}
      {action ? <span className="opacity-0 transition-opacity group-hover/sub:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100 max-md:pointer-coarse:opacity-100">{action}</span> : null}
    </div>
  );
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

type Kind = z.infer<typeof kindSchema> & { pluginId: string; providerName: string };

/** + on the Studio list: every kind of Studio item, made in the Space's folder. */
function NewItemMenu({ spaceId, spaceName, defaultProjectId, onCreated }: {
  spaceId: string;
  spaceName: string;
  defaultProjectId: string | null;
  onCreated(request: OpenInSpaceRequest): void;
}) {
  const sdk = useSdk();
  const [kinds, setKinds] = useState<Kind[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const call = useCallback(<T,>(method: string, input: unknown, outputSchema: z.ZodType<T>) =>
    sdk.plugins.callRpc({ pluginId: "studio", method, input: input as never, outputSchema, signal: AbortSignal.timeout(15_000) }) as Promise<T>, [sdk]);
  const load = () => {
    setError(null);
    call("overview", null, overviewSchema).then(
      ({ providers }) => setKinds(providers.filter((provider) => provider.state === "ready").flatMap((provider) =>
        provider.kinds.filter((kind) => kind.create && (kind.capabilities?.create ?? true)).map((kind) => ({ ...kind, pluginId: provider.pluginId, providerName: provider.name })))),
      (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)),
    );
  };
  const create = async (kind: Kind) => {
    if (kind.create?.mode === "event") {
      window.dispatchEvent(new CustomEvent(kind.create.event, { detail: { projectId: defaultProjectId }, cancelable: true }));
      return;
    }
    try {
      const { href, title } = await call("createInSpace", { id: spaceId, pluginId: kind.pluginId, kind: kind.id }, createdSchema);
      onCreated({ kind: "item", path: href, title: title ?? kind.label });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return (
    <DropdownMenu onOpenChange={(open) => { if (open) load(); }}>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={`New Studio item in ${spaceName}`} title="New Studio item" className={cn(SIDEBAR_CONTROL_BUTTON_CLASS, "inline-flex items-center justify-center")} onClick={(event) => event.stopPropagation()}>
          <Icon name="Plus" className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48" aria-label={`New in ${spaceName}`}>
        {(kinds ?? []).map((kind) => (
          <DropdownMenuItem key={`${kind.pluginId}:${kind.id}`} onSelect={() => void create(kind)}>
            <Icon name={kind.icon} className="size-4" />{kind.label}
          </DropdownMenuItem>
        ))}
        {error ? <DropdownMenuItem onSelect={(event) => { event.preventDefault(); load(); }} title={error}><Icon name="ArrowReloadHorizontal" className="size-4" />Retry</DropdownMenuItem>
          : kinds === null ? <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
            : !kinds.length ? <DropdownMenuItem disabled>Nothing to create</DropdownMenuItem> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * A Space's open Studio items, like tabs: each opens beside the lead, and ×
 * closes it here without touching the item. Opening any of the Space's items
 * adds it; the Studio label, or the button beside +, opens the rest in a Studio tab.
 */
export function SpaceStudioList({ spaceId, spaceName, defaultProjectId, items, onOpen }: {
  spaceId: string;
  spaceName: string;
  defaultProjectId: string | null;
  items: SpaceItems | undefined;
  onOpen(request: OpenInSpaceRequest): void;
}) {
  const sdk = useSdk();
  // Closed here until Studio's next list catches up.
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const key = (item: { pluginId: string; id: string }) => `${item.pluginId}:${item.id}`;
  const open = (items?.open ?? []).filter((item) => !closed.has(key(item)));
  const total = items?.count ?? 0;
  const close = (item: SpaceItems["open"][number]) => {
    setClosed((current) => new Set(current).add(key(item)));
    void sdk.plugins.callRpc({ pluginId: "studio", method: "closeTabs", input: { items: [{ pluginId: item.pluginId, id: item.id }] } as never, outputSchema: z.object({ ok: z.boolean() }), signal: AbortSignal.timeout(15_000) })
      .catch(() => setClosed((current) => { const next = new Set(current); next.delete(key(item)); return next; }));
  };
  const quietRow = cn(SIDEBAR_ROW_BASE_CLASS, SIDEBAR_ROW_INTERACTIVE_STATE_CLASS, COARSE_POINTER_ROW_HEIGHT_CLASS, "pl-2 text-left text-muted-foreground");
  return (
    <div role="group" aria-label={`${spaceName} Studio items`}>
      <SpaceSubheading
        title="Studio"
        count={open.length || undefined}
        onOpen={() => onOpen({ kind: "items" })}
        openLabel={`All Studio items in ${spaceName}`}
        action={(
          <span className="inline-flex items-center gap-0.5">
            {total ? (
              <button
                type="button"
                aria-label={`All Studio items in ${spaceName}`}
                title={`All ${total} ${total === 1 ? "item" : "items"}`}
                onClick={() => onOpen({ kind: "items" })}
                className={cn(SIDEBAR_CONTROL_BUTTON_CLASS, "inline-flex items-center justify-center")}
              >
                <Icon name="Layers" className="size-3.5" />
              </button>
            ) : null}
            <NewItemMenu spaceId={spaceId} spaceName={spaceName} defaultProjectId={defaultProjectId} onCreated={onOpen} />
          </span>
        )}
      />
      {open.map((item) => (
        <div key={key(item)} className="group/item relative" data-space-studio-item={key(item)}>
          <button
            type="button"
            title={item.title}
            onClick={() => onOpen({ kind: "item", path: item.href, title: item.title })}
            className={cn(SIDEBAR_ROW_BASE_CLASS, SIDEBAR_ROW_INTERACTIVE_STATE_CLASS, COARSE_POINTER_ROW_HEIGHT_CLASS, "pr-8 pl-2 text-left")}
          >
            <span className={cn(SIDEBAR_ROW_GLYPH_SLOT_CLASS, "size-4")}>
              {item.icon ? <span className="text-[13px] leading-none">{item.icon}</span> : <Icon name={item.kindIcon} className="size-4" />}
            </span>
            <span className="min-w-0 flex-1 truncate">{item.title}</span>
          </button>
          <button
            type="button"
            aria-label={`Close ${item.title}`}
            title="Close"
            onClick={() => close(item)}
            className={cn(SIDEBAR_CONTROL_BUTTON_CLASS, "absolute top-1/2 right-0.5 inline-flex -translate-y-1/2 items-center justify-center opacity-0 transition-opacity group-hover/item:opacity-100 focus-visible:opacity-100 max-md:pointer-coarse:opacity-100")}
          >
            <Icon name="X" className="size-3.5" />
          </button>
        </div>
      ))}
      {!open.length && !total ? (
        <button type="button" onClick={() => onOpen({ kind: "new-item" })} className={quietRow}>
          <span className={cn(SIDEBAR_ROW_GLYPH_SLOT_CLASS, "size-4")}><Icon name="Plus" className="size-3.5" /></span>
          <span className="truncate">New page, drawing or table</span>
        </button>
      ) : null}
    </div>
  );
}
