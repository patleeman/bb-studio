import { type useRpc } from "@get-bb/plugin-sdk/app";
import { errorMessage, untitled } from "../../kit/format";
import { useEffect, useRef, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../kit/ui/index";
import { Icon } from "../../kit/ui/index";
import { pagePath } from "../constants";
import type { BotView, PageMetaView, rpcContract } from "../contract";

export type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;
import { CopyReferenceMenuItem, LinkedThreadMenuItems, OpenInWindowMenuItem } from "../../kit/app/index";
import { toast } from "sonner";
export type BotsState = { available: boolean; reason: string | null; bots: BotView[] };

// Shared with every Studio plugin, so the chrome matches.
export { ICON_BUTTON } from "../../kit/app/index";
export { relativeTime } from "../../kit/format";

export function actorName(key: string, bots: BotView[]): string {
  if (key === "user") return "you";
  if (key.startsWith("bot:")) return bots.find((bot) => bot.id === key.slice(4))?.name ?? "a bot";
  if (key.startsWith("agent:")) return "an agent";
  if (key === "cli") return "the CLI";
  return key;
}

export function PageMenu({
  page,
  rpc,
  onChanged,
  onDeleted,
  triggerClassName,
  leading,
}: {
  page: PageMetaView;
  rpc: Rpc;
  onChanged(): void;
  onDeleted?(): void;
  triggerClassName?: string;
  /** Page-view actions listed above the shared ones. */
  leading?: React.ReactNode;
}) {
  const [pending, setPending] = useState(false);
  const running = useRef(false);
  const mutate = async (work: () => Promise<unknown>, success: () => void, label: string) => {
    if (running.current) return;
    running.current = true;
    setPending(true);
    try {
      await work();
      success();
    } catch (error) {
      toast.error(label, { description: errorMessage(error) });
    } finally {
      running.current = false;
      setPending(false);
    }
  };
  const update = async (patch: { parentId?: string | null; archived?: boolean }) => {
    await mutate(() => rpc.call("pages.update", { id: page.id, ...patch }), onChanged, "Couldn't update the page");
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Page actions"
          disabled={pending}
          className={triggerClassName ?? "rounded-md p-1 text-muted-foreground hover:bg-state-hover hover:text-foreground"}
          onClick={(event) => event.stopPropagation()}
        >
          <Icon name="MoreHorizontal" className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56" onClick={(event) => event.stopPropagation()}>
        {leading}
        <OpenInWindowMenuItem href={pagePath(page.id)} title={untitled(page.title)} />
        <CopyReferenceMenuItem item={{ href: pagePath(page.id), title: untitled(page.title), ...(page.icon ? { icon: page.icon } : {}) }} />
        <LinkedThreadMenuItems href={pagePath(page.id)} />
        {page.parentId ? (
          <DropdownMenuItem disabled={pending} onSelect={() => void update({ parentId: null })}>
            <Icon name="ChevronLeft" className="size-4" /> Move to top level
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem disabled={pending} onSelect={() => void update({ archived: !page.archived })}>
          <Icon name={page.archived ? "ArchiveRestore" : "Archive"} className="size-4" /> {page.archived ? "Restore from archive" : "Archive"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={pending}
          className="text-destructive focus:bg-destructive/15 focus:text-destructive"
          onSelect={async () => {
            if (!window.confirm(`Delete "${untitled(page.title)}" and every page inside it? This can't be undone.`)) return;
            await mutate(() => rpc.call("pages.remove", { id: page.id }), () => {
              onChanged();
              onDeleted?.();
            }, "Couldn't delete the page");
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
