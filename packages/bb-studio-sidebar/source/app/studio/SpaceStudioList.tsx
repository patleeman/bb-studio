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
  getSidebarThreadRowPaddingLeft,
} from "../rows/sidebarRowClasses.js";
import type { OpenInSpaceRequest } from "./openInSpace.js";
import type { SpaceItems } from "./studioSpaces.js";

/** Rows before "Show more": enough to see what's there without burying Threads. */
const COLLAPSED_ITEMS = 6;

/** "Studio" or "Threads" inside a Space, with its own + on hover. */
export function SpaceSubheading({ title, count, action }: { title: string; count?: number; action?: ReactNode }) {
  return (
    <div className={cn("group/sub flex h-7 items-center gap-1 pr-0.5 pl-2 text-xs", SIDEBAR_GROUP_TEXT_CLASS)}>
      <span className="min-w-0 flex-1 truncate">{title}{count ? <span className="ml-1.5 tabular-nums opacity-70">{count}</span> : null}</span>
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
 * A Space's Studio items: pages, drawings, tables… Each opens beside the lead.
 * Studio sends only the first items; past those, a row opens the Space.
 */
export function SpaceStudioList({ spaceId, spaceName, defaultProjectId, items, onOpen, onOpenSpace }: {
  spaceId: string;
  spaceName: string;
  defaultProjectId: string | null;
  items: SpaceItems | undefined;
  onOpen(request: OpenInSpaceRequest): void;
  onOpenSpace(): void;
}) {
  const [expanded, setExpanded] = useState(false);
  const list = items?.items ?? [];
  const shown = expanded ? list : list.slice(0, COLLAPSED_ITEMS);
  const hidden = list.length - shown.length;
  const total = items?.count ?? list.length;
  return (
    <div role="group" aria-label={`${spaceName} Studio items`}>
      <SpaceSubheading
        title="Studio"
        count={items?.count}
        action={<NewItemMenu spaceId={spaceId} spaceName={spaceName} defaultProjectId={defaultProjectId} onCreated={onOpen} />}
      />
      {shown.map((item) => (
        <button
          key={`${item.pluginId}:${item.id}`}
          type="button"
          title={item.title}
          onClick={() => onOpen({ kind: "item", path: item.href, title: item.title })}
          className={cn(SIDEBAR_ROW_BASE_CLASS, SIDEBAR_ROW_INTERACTIVE_STATE_CLASS, COARSE_POINTER_ROW_HEIGHT_CLASS, "text-left")}
          style={{ paddingLeft: getSidebarThreadRowPaddingLeft(item.depth) }}
        >
          <span className={cn(SIDEBAR_ROW_GLYPH_SLOT_CLASS, "size-4")}>
            {item.icon ? <span className="text-[13px] leading-none">{item.icon}</span> : <Icon name={item.kindIcon} className="size-4" />}
          </span>
          <span className="min-w-0 flex-1 truncate">{item.title}</span>
        </button>
      ))}
      {!list.length ? (
        <button
          type="button"
          onClick={() => onOpen({ kind: "new-item" })}
          className={cn(SIDEBAR_ROW_BASE_CLASS, SIDEBAR_ROW_INTERACTIVE_STATE_CLASS, COARSE_POINTER_ROW_HEIGHT_CLASS, "pl-2 text-left text-muted-foreground")}
        >
          <span className={cn(SIDEBAR_ROW_GLYPH_SLOT_CLASS, "size-4")}><Icon name="Plus" className="size-3.5" /></span>
          <span className="truncate">New page, drawing or table</span>
        </button>
      ) : null}
      {hidden > 0 || expanded ? (
        <button type="button" onClick={() => setExpanded((value) => !value)} className={cn(SIDEBAR_ROW_BASE_CLASS, SIDEBAR_ROW_INTERACTIVE_STATE_CLASS, "h-7 pl-8 text-left text-xs text-muted-foreground")}>
          {expanded ? "Show less" : `Show ${hidden} more`}
        </button>
      ) : null}
      {hidden === 0 && total > list.length ? (
        <button type="button" onClick={onOpenSpace} className={cn(SIDEBAR_ROW_BASE_CLASS, SIDEBAR_ROW_INTERACTIVE_STATE_CLASS, "h-7 pl-8 text-left text-xs text-muted-foreground")}>
          {`All ${total} in ${spaceName}`}
        </button>
      ) : null}
    </div>
  );
}
