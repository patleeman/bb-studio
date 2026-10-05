// "Move to": one menu for moving Studio items into a Space or a project, from
// an item's ⋯ menu, a collection row, or the collection's bulk Move. Spaces
// come from Studio; without it the menu lists projects only. Items follow
// their project, so Studio moves an item into a Space through the Space's own
// project, and leaves items already in that Space where they are.
import { useSdk } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { STUDIO_PLUGIN_ID } from "../contract";
import { errorMessage } from "../format";
import { Icon } from "../ui/icon";
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from "../ui/dropdown-menu";
import { useProjects, type Project } from "./pieces";

export type ItemRef = { pluginId: string; id: string };

/** Studio's event after a Space's contents change; the sidebar refetches. */
const SPACE_CHANGED_EVENT = "studio:space-changed";

const spaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().catch("currentColor"),
  icon: z.string().nullable().catch(null),
  isDefault: z.boolean().catch(false),
  projectIds: z.array(z.string()).catch([]),
});
export type MoveSpace = z.infer<typeof spaceSchema>;
const spacesSchema = z.object({ spaces: z.array(spaceSchema) });
const movedSchema = z.object({ moved: z.number(), unchanged: z.number(), failed: z.array(z.object({ title: z.string(), error: z.string() })) });

type StudioRpc = { plugins: { callRpc(options: { pluginId: string; method: string; input: never; outputSchema: z.ZodType }): Promise<unknown> } };

let cached: { at: number; spaces: Promise<MoveSpace[]> } | null = null;
const CACHE_MS = 10_000;

function loadSpaces(sdk: StudioRpc): Promise<MoveSpace[]> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.spaces;
  const spaces = sdk.plugins
    .callRpc({ pluginId: STUDIO_PLUGIN_ID, method: "spaces", input: null as never, outputSchema: spacesSchema })
    .then((result) => (result as z.infer<typeof spacesSchema>).spaces)
    // Without Studio there are no Spaces; the menu lists projects.
    .catch(() => []);
  cached = { at: Date.now(), spaces };
  return spaces;
}

/** Studio's Spaces, or [] without Studio; null while loading. */
export function useMoveSpaces(): MoveSpace[] | null {
  const sdk = useSdk() as unknown as StudioRpc;
  const [spaces, setSpaces] = useState<MoveSpace[] | null>(null);
  useEffect(() => {
    let live = true;
    void loadSpaces(sdk).then((list) => live && setSpaces(list));
    return () => {
      live = false;
    };
  }, [sdk]);
  return spaces;
}

/** The Space holding a project: the one that lists it, or the default Space for Global and unlisted projects. */
export function spaceOfProject(spaces: readonly MoveSpace[], projectId: string | null): MoveSpace | null {
  return (projectId ? spaces.find((space) => space.projectIds.includes(projectId)) : null) ?? spaces.find((space) => space.isDefault) ?? spaces[0] ?? null;
}

/** Moves items into a Space through Studio and says what happened. Resolves true when anything moved. */
export async function moveToSpace(sdk: StudioRpc, space: Pick<MoveSpace, "id" | "name">, items: readonly ItemRef[]): Promise<boolean> {
  try {
    const result = (await sdk.plugins.callRpc({
      pluginId: STUDIO_PLUGIN_ID,
      method: "moveToSpace",
      input: { id: space.id, items: items.map(({ pluginId, id }) => ({ pluginId, id })) } as never,
      outputSchema: movedSchema,
    })) as z.infer<typeof movedSchema>;
    cached = null;
    if (result.moved) {
      window.dispatchEvent(new CustomEvent(SPACE_CHANGED_EVENT, { detail: { spaceId: space.id } }));
      toast.success(`Moved ${result.moved === 1 && items.length === 1 ? "" : `${result.moved} ${result.moved === 1 ? "item" : "items"} `}to ${space.name}`);
    } else if (result.unchanged && !result.failed.length) toast(`Already in ${space.name}`);
    if (result.failed.length) toast.error(`Couldn't move ${result.failed.length === 1 ? `"${result.failed[0]!.title}"` : `${result.failed.length} items`}: ${result.failed[0]!.error}`);
    return result.moved > 0;
  } catch (cause) {
    toast.error(`Couldn't move to ${space.name}: ${errorMessage(cause)}`);
    return false;
  }
}

function SpaceMark({ space }: { space: MoveSpace }) {
  return space.icon ? (
    <span className="flex size-4 items-center justify-center text-sm leading-none">{space.icon}</span>
  ) : (
    <span className="flex size-4 items-center justify-center">
      <span className="size-2.5 rounded-full" style={{ backgroundColor: space.color }} />
    </span>
  );
}

/**
 * The choices of a Move to menu: Spaces, then projects. `projectId` is where
 * the items are now, or undefined when they're in different places.
 */
export function MoveToItems({
  items,
  projects: given,
  projectId,
  onProject,
  onMoved,
}: {
  items: readonly ItemRef[];
  /** Fetched when left out. */
  projects?: readonly Project[];
  projectId?: string | null;
  onProject(projectId: string | null): void;
  /** After a move into a Space. */
  onMoved?(): void;
}) {
  const sdk = useSdk() as unknown as StudioRpc;
  const fetched = useProjects();
  const projects = given ?? fetched;
  const loaded = useMoveSpaces();
  // Without item refs, only projects can be offered.
  const spaces = items.length ? loaded : [];
  const current = projectId === undefined || !spaces ? null : spaceOfProject(spaces, projectId);
  const projectSpace = (id: string) => (spaces && spaces.length > 1 ? spaceOfProject(spaces, id)?.name : undefined);
  return (
    <>
      {spaces === null ? (
        <DropdownMenuItem disabled>
          <Icon name="Loading" className="size-4 animate-spin motion-reduce:animate-none" /> Spaces…
        </DropdownMenuItem>
      ) : spaces.length ? (
        <>
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Spaces</DropdownMenuLabel>
          {spaces.map((space) => (
            <DropdownMenuItem
              key={space.id}
              disabled={space.id === current?.id}
              onSelect={() => void moveToSpace(sdk, space, items).then((moved) => moved && onMoved?.())}
            >
              <SpaceMark space={space} />
              <span className="truncate">{space.name}</span>
              {space.id === current?.id ? <Icon name="Check" className="ml-auto size-3.5" /> : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
        </>
      ) : null}
      <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Projects</DropdownMenuLabel>
      <DropdownMenuItem disabled={projectId === null} onSelect={() => onProject(null)}>
        <Icon name="Globe" className="size-4" /> Global
        {projectId === null ? <Icon name="Check" className="ml-auto size-3.5" /> : null}
      </DropdownMenuItem>
      {projects.map((project) => (
        <DropdownMenuItem key={project.id} disabled={project.id === projectId} onSelect={() => onProject(project.id)}>
          <Icon name="Folder" className="size-4" />
          <span className="truncate">{project.name}</span>
          {project.id === projectId ? (
            <Icon name="Check" className="ml-auto size-3.5" />
          ) : projectSpace(project.id) ? (
            <span className="ml-auto max-w-24 shrink-0 truncate pl-2 text-xs text-muted-foreground">{projectSpace(project.id)}</span>
          ) : null}
        </DropdownMenuItem>
      ))}
    </>
  );
}

/** "Move to ▸" for a menu: Spaces and projects in a submenu. */
export function MoveToSubmenu(props: Parameters<typeof MoveToItems>[0]) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Icon name="MoveTo" className="size-4" /> Move to
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-96 w-60 overflow-y-auto">
        <MoveToItems {...props} />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
