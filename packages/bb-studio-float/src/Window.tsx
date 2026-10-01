// One window: its title bar, and a thread or another plugin's panel below.
import { experimental_useSidebarThreadActions, ThreadChat, ThreadTitle } from "@get-bb/plugin-sdk/app";
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Icon,
  openAppPath,
  publishFloatBody,
  publishFloatLeading,
  useCanFloat,
} from "@bb-studio/kit/app";
import { useEffect, useState } from "react";
import { update } from "./store";
import { closeWindow, setMinimized, type FloatWindow } from "./windows";

export const HEADER_BUTTON =
  "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground";

/** A path window's title when its opener gave none: the plugin's name. */
export function pathTitle(path: string): string {
  const plugin = path.split("/")[2] ?? "";
  return plugin ? plugin.charAt(0).toUpperCase() + plugin.slice(1).replace(/-/g, " ") : "Window";
}

/** Publishes `element` under the window's key for as long as it's mounted. */
function usePublished(publish: typeof publishFloatBody, window: FloatWindow, element: HTMLElement | null) {
  useEffect(() => {
    if (!element) return;
    publish({ windowKey: window.key, target: window.target, element });
    return () => publish({ windowKey: window.key, element: null });
    // The key decides the target; a new title needn't republish.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publish, window.key, element]);
}

function ThreadBody({ window, threadId }: { window: FloatWindow; threadId: string }) {
  const [leading, setLeading] = useState<HTMLDivElement | null>(null);
  usePublished(publishFloatLeading, window, leading);
  return (
    <ThreadChat
      threadId={threadId}
      variant="compact"
      className="min-h-0 flex-1"
      leadingContent={<div ref={setLeading} className="float-leading empty:hidden" />}
    />
  );
}

function PathBody({ window }: { window: FloatWindow }) {
  const [body, setBody] = useState<HTMLDivElement | null>(null);
  const shown = useCanFloat(window.target);
  usePublished(publishFloatBody, window, body);
  if (!shown || window.target.kind !== "path") {
    // The plugin that shows this path isn't running (yet, or any more).
    const path = window.target.kind === "path" ? window.target.path : "";
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
        <p>This can't show in a window right now.</p>
        <button type="button" className="rounded-md border border-border px-3 py-1.5 text-foreground hover:bg-state-hover" onClick={() => openAppPath(path)}>
          Open it
        </button>
      </div>
    );
  }
  return <div ref={setBody} className="float-body relative min-h-0 flex-1 overflow-auto" />;
}

export function Window({ window, width }: { window: FloatWindow; width: number }) {
  const actions = experimental_useSidebarThreadActions();
  const { target, minimized } = window;
  const close = () => update((state) => closeWindow(state, window.key));
  const toggle = () => update((state) => setMinimized(state, window.key, !minimized));
  const openFull = (split: boolean) => {
    // BB's own view takes over; the window would only repeat it.
    close();
    if (target.kind === "thread") actions.open(target.threadId, { split });
    else openAppPath(target.path);
  };
  const icon = target.kind === "thread" ? "MessageSquare" : (target.icon ?? "AppWindow");

  return (
    <section
      aria-label={target.title ?? "Floating window"}
      data-float-window={window.key}
      className={cn(
        "float-window pointer-events-auto flex shrink-0 flex-col overflow-hidden rounded-t-lg border border-b-0 border-border bg-background shadow-xl",
        !minimized && "h-[min(560px,calc(100vh-6rem))]",
      )}
      style={{ width }}
    >
      <header className="flex h-10 shrink-0 items-center gap-1 border-b border-border pr-1 pl-2">
        <button
          type="button"
          className="float-title flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium"
          onClick={toggle}
          title={minimized ? "Open" : "Minimize"}
        >
          <Icon name={icon} className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">
            {target.title ?? (target.kind === "thread" ? <ThreadTitle threadId={target.threadId} /> : pathTitle(target.path))}
          </span>
        </button>
        <button type="button" aria-label={minimized ? "Open window" : "Minimize window"} className={HEADER_BUTTON} onClick={toggle}>
          <Icon name={minimized ? "ChevronUp" : "Minus"} className="size-4" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Window actions" className={HEADER_BUTTON}>
              <Icon name="MoreHorizontal" className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={() => openFull(false)}>
              <Icon name="Maximize2" className="size-4" /> Open full
            </DropdownMenuItem>
            {target.kind === "thread" ? (
              <DropdownMenuItem onSelect={() => openFull(true)}>
                <Icon name="Columns2" className="size-4" /> Open in split
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={close}>
              <Icon name="X" className="size-4" /> Close
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button type="button" aria-label="Close window" className={HEADER_BUTTON} onClick={close}>
          <Icon name="X" className="size-4" />
        </button>
      </header>
      {minimized ? null : target.kind === "thread" ? (
        <ThreadBody key={window.key} window={window} threadId={target.threadId} />
      ) : (
        <PathBody key={window.key} window={window} />
      )}
    </section>
  );
}
