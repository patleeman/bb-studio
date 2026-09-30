import { useSdk, type useRpc } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { BotView, PageMetaView, rpcContract } from "../contract";

export type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;
export type Project = { id: string; name: string };
export type BotsState = { available: boolean; reason: string | null; bots: BotView[] };

// Shared with every Studio plugin, so the chrome matches.
export { FLOATING, ICON_BUTTON } from "@bb-studio/kit/app";
export { relativeTime } from "@bb-studio/kit/format";

export function actorName(key: string, bots: BotView[]): string {
  if (key === "user") return "you";
  if (key.startsWith("bot:")) return bots.find((bot) => bot.id === key.slice(4))?.name ?? "a bot";
  if (key.startsWith("agent:")) return "an agent";
  if (key === "cli") return "the CLI";
  return key;
}

export const editedByAgent = (key: string) => key.startsWith("bot:") || key.startsWith("agent:");

export function useProjects(): Project[] {
  const sdk = useSdk();
  const [projects, setProjects] = useState<Project[]>([]);
  useEffect(() => {
    sdk.projects
      .list()
      .then((list) => setProjects((list as { id: string; name: string }[]).map(({ id, name }) => ({ id, name }))))
      .catch(() => setProjects([]));
  }, [sdk]);
  return projects;
}

/** The page's icon on a soft tile, or a document glyph when it has none. */
export function IconTile({ page, size = "md" }: { page: PageMetaView; size?: "md" | "lg" }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg bg-foreground/[0.06] leading-none",
        size === "lg" ? "size-10 text-xl" : "size-8 text-base",
      )}
    >
      {page.icon || <Icon name="FileText" className="size-4 text-muted-foreground" />}
    </span>
  );
}

export function PageMenu({
  page,
  rpc,
  projects,
  onChanged,
  onDeleted,
  triggerClassName,
  leading,
}: {
  page: PageMetaView;
  rpc: Rpc;
  projects: Project[];
  onChanged(): void;
  onDeleted?(): void;
  triggerClassName?: string;
  /** Page-view actions listed above the shared ones. */
  leading?: React.ReactNode;
}) {
  const update = async (patch: { parentId?: string | null; projectId?: string | null; archived?: boolean }) => {
    await rpc.call("update", { id: page.id, ...patch });
    onChanged();
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Page actions"
          className={triggerClassName ?? "rounded-md p-1 text-muted-foreground hover:bg-state-hover hover:text-foreground"}
          onClick={(event) => event.stopPropagation()}
        >
          <Icon name="MoreHorizontal" className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56" onClick={(event) => event.stopPropagation()}>
        {leading}
        {page.parentId ? (
          <DropdownMenuItem onSelect={() => void update({ parentId: null })}>
            <Icon name="ChevronLeft" className="size-4" /> Move to top level
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Icon name="Folder" className="size-4" /> Move to project
            <Icon name="ChevronRight" className="ml-auto size-3.5 text-muted-foreground" />
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-80 w-52 overflow-auto">
            <DropdownMenuItem onSelect={() => void update({ projectId: null, parentId: null })}>
              Global
              {!page.projectId ? <Icon name="Check" className="ml-auto size-3.5" /> : null}
            </DropdownMenuItem>
            {projects.map((project) => (
              <DropdownMenuItem key={project.id} onSelect={() => void update({ projectId: project.id, parentId: null })}>
                <span className="truncate">{project.name}</span>
                {project.id === page.projectId ? <Icon name="Check" className="ml-auto size-3.5" /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem onSelect={() => void update({ archived: !page.archived })}>
          <Icon name="Archive" className="size-4" /> {page.archived ? "Restore from archive" : "Archive"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:bg-destructive/15 focus:text-destructive"
          onSelect={() => {
            if (!window.confirm(`Delete "${page.title || "Untitled"}" and every page inside it? This can't be undone.`)) return;
            void rpc.call("remove", { id: page.id }).then(() => {
              onChanged();
              onDeleted?.();
            });
          }}
        >
          <Icon name="Trash2" className="size-4" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function useDarkMode(): boolean {
  const read = () => document.documentElement.classList.contains("dark") || document.body.classList.contains("dark");
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}
