// Hand a thread to another agent: pick the provider and model in BB's own
// composer, add a note if you like, and the work continues there with the
// Space's page. A Space's lead moves with it.
import {
  experimental_NewThreadComposer as NewThreadComposer,
  experimental_useSidebarThreadActions as useSidebarThreadActions,
  type NewThreadRequest,
  type PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@bb-studio/kit/ui";
import { GHOST_BUTTON, Icon } from "@bb-studio/kit/app";
import { useState } from "react";
import { useCall } from "./data";
import { OpenSpacePage } from "./ThreadSpacePage";
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
          <DialogTitle>Hand off</DialogTitle>
          <DialogDescription>
            Choose who continues this work. They get a summary of the thread, the Space's page; this thread is archived.
          </DialogDescription>
          <NewThreadComposer defaultProjectId={projectId} placeholder="A note for the next agent (optional), e.g. “Pick up from the release checklist.”" draftKey={`handoff:${threadId}`} onSubmit={handOff} />
          {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
          </DialogContent>
    </Dialog>
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
      <OpenSpacePage threadId={threadId} />
    </>
  );
}
