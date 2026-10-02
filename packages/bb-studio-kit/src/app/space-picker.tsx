// Spaces from the item itself: the header button showing the spaces an item
// is in, and the checklist that adds it to or takes it out of each, shared
// with the collection's menus. Spaces live in Studio, so the button hides
// when Studio is absent.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRealtime, useSdk } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { z } from "zod";
import { STUDIO_PLUGIN_ID, STUDIO_REALTIME_CHANNEL } from "../contract";
import { errorMessage } from "../format";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { Icon } from "../ui/icon";
import { cn } from "../ui/utils";
import { FLOATING_BUTTON, ICON_BUTTON, projectName, useProjects, type Project } from "./pieces";
import type { RelatedRef } from "./related-panel";
import { spaceMembership, type SpaceMembership } from "./space-state";

export interface MenuSpace {
  id: string;
  name: string;
  glyph?: ReactNode;
}

/**
 * Menu rows that add or take the chosen items out of each space. A space
 * that holds them all through their project can't change here, so it's
 * checked but disabled, naming the project.
 */
export function SpaceMenuItems<T extends MenuSpace>({
  spaces,
  projects,
  state,
  onToggle,
}: {
  spaces: readonly T[];
  projects: readonly Project[];
  state(space: T): SpaceMembership;
  onToggle(space: T, add: boolean): void;
}) {
  if (!spaces.length) return <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">No spaces yet</DropdownMenuLabel>;
  return (
    <>
      {spaces.map((space) => {
        const { has, through } = state(space);
        return (
          <DropdownMenuItem
            key={space.id}
            disabled={through.length > 0}
            // Stay open, so several spaces can be set in one go.
            onSelect={(event) => {
              event.preventDefault();
              onToggle(space, has !== true);
            }}
          >
            {space.glyph}
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{space.name}</span>
              {through.length ? (
                <span className="truncate text-[11px] text-muted-foreground">
                  Through {through.map((id) => projectName(projects, id)).join(", ")}
                </span>
              ) : null}
            </span>
            {has === true ? <Icon name="Check" className="ml-auto size-3.5" /> : has === "mixed" ? <Icon name="Minus" className="ml-auto size-3.5" /> : null}
          </DropdownMenuItem>
        );
      })}
    </>
  );
}

/** A space's emoji, or the spaces icon: a colour dot here reads as a status. */
export function SpaceMark({ icon }: { icon: string | null | undefined }) {
  return icon ? <span className="w-4 shrink-0 text-center text-sm leading-none">{icon}</span> : <Icon name="Layers" className="size-4" />;
}

const spaceSchema = z.object({ id: z.string(), name: z.string(), icon: z.string().nullable(), projectIds: z.array(z.string()), pageId: z.string().nullable() }).passthrough();
type Space = z.infer<typeof spaceSchema>;
const spacesSchema = z.object({ spaces: z.array(spaceSchema) });
const itemsSchema = z.object({ items: z.array(z.object({ projectId: z.string().nullable(), spaces: z.array(z.string()) }).passthrough()) });
const membersSchema = z.object({ space: spaceSchema });
type Held = { projectId: string | null; spaces: string[] };
const REFETCH_DEBOUNCE_MS = 300;

/** The item header's spaces button. Hidden without Studio, and on spaces and their own pages. */
export function SpacePicker({ item }: { item: RelatedRef }) {
  const sdk = useSdk();
  const [spaces, setSpaces] = useState<Space[] | null>(null);
  const [held, setHeld] = useState<Held | null>(null);
  const call = useCallback(
    <T,>(method: string, input: unknown, outputSchema: z.ZodType<T>) =>
      sdk.plugins.callRpc({ pluginId: STUDIO_PLUGIN_ID, method, input: input as never, outputSchema }),
    [sdk],
  );
  const load = useCallback(() => {
    if (item.pluginId === STUDIO_PLUGIN_ID) return;
    Promise.all([call("spaces", null, spacesSchema), call("items", { pluginId: item.pluginId, ids: [item.id] }, itemsSchema)]).then(
      ([listed, found]) => {
        setSpaces(listed.spaces);
        // Items Studio doesn't list can't join a space.
        setHeld(found.items[0] ?? null);
      },
      () => setHeld(null),
    );
  }, [call, item.pluginId, item.id]);
  useEffect(load, [load]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  useRealtime(STUDIO_REALTIME_CHANNEL, () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(load, REFETCH_DEBOUNCE_MS);
  });

  if (!spaces || !held || spaces.some((space) => space.pageId === item.id && item.pluginId === "pages")) return null;
  const holding = spaces.filter((space) => held.spaces.includes(space.id));
  const [first] = holding;
  const toggle = async (space: Space, add: boolean) => {
    // Show the change now; the reload confirms it.
    setHeld((previous) => previous && { ...previous, spaces: add ? [...previous.spaces, space.id] : previous.spaces.filter((id) => id !== space.id) });
    const ref = [{ pluginId: item.pluginId, id: item.id }];
    try {
      await call("spaceMembers", { id: space.id, add: add ? ref : [], remove: add ? [] : ref }, membersSchema);
    } catch (cause) {
      toast.error(`Couldn't change the space: ${errorMessage(cause)}`);
    } finally {
      load();
    }
  };
  const names = holding.map((space) => space.name).join(", ");
  return (
    <DropdownMenu onOpenChange={(open) => open && load()}>
      <DropdownMenuTrigger asChild>
        {first ? (
          <button type="button" className={cn(FLOATING_BUTTON, "max-w-56")} aria-label={`Spaces: ${names}`} title={names}>
            <SpaceMark icon={first.icon} />
            <span className="truncate">{first.name}</span>
            {holding.length > 1 ? <span className="shrink-0 text-xs">+{holding.length - 1}</span> : null}
          </button>
        ) : (
          <button type="button" className={ICON_BUTTON} aria-label="Add to space" title="Add to space">
            <Icon name="Layers" className="size-4" />
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-60 overflow-auto">
        <PickerItems spaces={spaces} held={held} onToggle={(space, add) => void toggle(space, add)} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Mounted only while the menu is open, so projects load when needed.
function PickerItems({ spaces, held, onToggle }: { spaces: readonly Space[]; held: Held; onToggle(space: Space, add: boolean): void }) {
  const projects = useProjects();
  return (
    <>
      {spaces.length ? <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Spaces</DropdownMenuLabel> : null}
      <SpaceMenuItems
        spaces={spaces.map((space) => ({ ...space, glyph: <SpaceMark icon={space.icon} /> }))}
        projects={projects}
        state={(space) => spaceMembership(space, [held])}
        onToggle={onToggle}
      />
    </>
  );
}
