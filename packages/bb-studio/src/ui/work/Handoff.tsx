// Hand a thread to another agent: pick the provider and model in BB's own
// composer, add a note if you like, and the work continues there with the
// project's page and memory. A project's lead moves with it.
import * as Dialog from "@radix-ui/react-dialog";
import {
  experimental_NewThreadComposer as NewThreadComposer,
  experimental_useSidebarThreadActions as useSidebarThreadActions,
  type NewThreadRequest,
  type PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";
import { GHOST_BUTTON, Icon } from "@bb-studio/kit/app";
import { useState } from "react";
import { useCall } from "./model";
import { OpenProjectPage } from "./ThreadProjectPage";
import { PORTAL_SCOPE } from "./styles";

export function HandoffDialog({ threadId, projectId, open, onOpenChange, onDone }: {
  threadId: string;
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: (newThreadId: string) => void;
}) {
  const call = useCall();
  const threadActions = useSidebarThreadActions();
  const [error, setError] = useState<string | null>(null);
  const handOff = async (request: NewThreadRequest) => {
    setError(null);
    try {
      const { threadId: next } = await call("thread_handoff", { threadId, request }) as { threadId: string };
      onOpenChange(false);
      if (onDone) onDone(next);
      else threadActions.open(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    }
  };
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay {...PORTAL_SCOPE} className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content {...PORTAL_SCOPE} className="fixed top-1/2 left-1/2 z-50 w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-popover p-5 text-popover-foreground shadow-xl outline-none">
          <Dialog.Title className="text-base font-semibold">Hand off</Dialog.Title>
          <Dialog.Description className="mt-1 mb-4 text-sm text-muted-foreground">
            Choose who continues this work. They get a summary of the thread, the project's page and its memory; this thread is archived.
          </Dialog.Description>
          <NewThreadComposer defaultProjectId={projectId} placeholder="A note for the next agent (optional), e.g. “Pick up from the release checklist.”" draftKey={`handoff:${threadId}`} onSubmit={handOff} />
          {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
          <div className="mt-4 flex justify-end"><Dialog.Close className={GHOST_BUTTON}>Cancel</Dialog.Close></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** "Hand off" in every thread's header. */
export function ThreadHandoffAction({ threadId, projectId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title="Hand off to another agent" aria-label="Hand off to another agent" className={GHOST_BUTTON}>
        <Icon name="Fork" className="size-4" />{isCompactViewport ? null : "Hand off"}
      </button>
      <HandoffDialog threadId={threadId} projectId={projectId} open={open} onOpenChange={setOpen} />
      <OpenProjectPage threadId={threadId} />
    </>
  );
}
