// A small VS Code button (the code icon) in a thread's header, shown once the thread has a
// workspace or has edited files: one click opens that exact workspace beside
// the chat. A dot pulses while the agent is editing.
//
// When Studio draws its Space menu in the same header, the chip hides and the
// menu offers "Open in VS Code" instead. The two plugins talk through window
// events (names shared with bb-studio's ThreadSpaceLink), so each still works
// alone: the chip announces itself and its state, and opens on request.
import { useCallback, useEffect, useState } from "react";
import { useBbNavigate, useRealtime, useRpc, type PluginThreadHeaderActionProps } from "@get-bb/plugin-sdk/app";
import { Icon } from "@bb-studio/kit/app";
import { CHANNEL, CODE_TAB, PANEL_PATH, type CodeContract } from "./shared";

type Chip = { workspaceId: string | null; title: string; working: boolean };

export function ThreadCodeChip({ threadId }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<CodeContract>();
  const navigate = useBbNavigate();
  const [chip, setChip] = useState<Chip | null>(null);
  const load = useCallback(() => {
    rpc.call("threadChip", { threadId }).then(({ chip }) => setChip(chip), () => undefined);
  }, [rpc, threadId]);
  useEffect(load, [load]);
  // This thread's editing started or stopped, or a workspace came or went.
  useRealtime(CHANNEL, (event) => {
    const message = event as { type?: string; threadId?: string; id?: string } | null;
    if (message?.type === "key") return;
    if (message?.type !== "thread" || message.threadId === threadId) load();
  });
  const open = useCallback(() => {
    // `at` makes an open tab come back from its workspace list to this thread's worktree.
    const params = { ...(chip?.workspaceId ? { workspaceId: chip.workspaceId } : {}), at: Date.now() };
    if (!navigate.openThreadPanel({ actionId: CODE_TAB, title: "VS Code", params }) && chip?.workspaceId)
      navigate.toPluginPanel(PANEL_PATH, { subPath: chip.workspaceId });
  }, [chip, navigate]);
  const spaceMenu = useSpaceMenu(threadId);
  // Tell Studio's Space menu this thread can open VS Code, and whether the agent is editing.
  useEffect(() => {
    const announce = () => window.dispatchEvent(new CustomEvent(CODE_STATE_EVENT, { detail: { threadId, working: chip?.working ?? false } }));
    announce();
    const onOpen = (event: Event) => {
      if ((event as CustomEvent<{ threadId?: string }>).detail?.threadId !== threadId) return;
      event.preventDefault();
      open();
    };
    window.addEventListener(CODE_QUERY_EVENT, announce);
    window.addEventListener(CODE_OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener(CODE_QUERY_EVENT, announce);
      window.removeEventListener(CODE_OPEN_EVENT, onOpen);
      window.dispatchEvent(new CustomEvent(CODE_STATE_EVENT, { detail: { threadId, gone: true } }));
    };
  }, [threadId, chip?.working, open]);
  if (!chip || spaceMenu) return null;
  const label = chip.working ? `Open ${chip.title} in VS Code: the agent is editing files` : `Open ${chip.title} in VS Code`;
  return (
    <button type="button" className={CHIP} title={label} aria-label={label} onClick={open}>
      <Icon name="Code" className="size-4" />
      {chip.working && (
        <span aria-hidden className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary ring-2 ring-background motion-safe:animate-pulse" />
      )}
    </button>
  );
}

const CODE_STATE_EVENT = "studio:code-state";
const CODE_QUERY_EVENT = "studio:code-query";
const CODE_OPEN_EVENT = "studio:code-open";
const SPACE_MENU_EVENT = "studio:space-menu";

/** Whether Studio's Space menu is in this thread's header, offering VS Code itself. */
function useSpaceMenu(threadId: string): boolean {
  const read = useCallback(() => Boolean((window as { __studioSpaceMenus?: Set<string> }).__studioSpaceMenus?.has(threadId)), [threadId]);
  const [shown, setShown] = useState(read);
  useEffect(() => {
    const update = () => setShown(read());
    update();
    window.addEventListener(SPACE_MENU_EVENT, update);
    return () => window.removeEventListener(SPACE_MENU_EVENT, update);
  }, [read]);
  return shown;
}

/** An icon button with a visible edge, so it reads as a button in the header. */
const CHIP =
  "relative inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground shadow-sm outline-none hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4";
