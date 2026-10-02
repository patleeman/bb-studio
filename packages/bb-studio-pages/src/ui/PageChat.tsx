import { errorMessage, untitled } from "@bb-studio/kit/format";
import { FLOATING, openCompanion } from "@bb-studio/kit/app";
import { experimental_NewThreadComposer as NewThreadComposer, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Icon, cn } from "@bb-studio/kit/ui";
import type { PageMetaView } from "../contract";
import type { Rpc } from "./shared";

/** The standalone Pages fallback uses the same conversation destination as Studio Chat. */
export function openPageConversation(threadId: string, navigate: ReturnType<typeof useBbNavigate>) {
  if (!openCompanion({ kind: "thread", threadId })) navigate.toThread(threadId);
}

export function PageChat({ page, rpc, threadId, onStarted }: {
  page: PageMetaView;
  rpc: Rpc;
  threadId: string | null;
  onStarted(threadId: string): void;
}) {
  const navigate = useBbNavigate();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState(0);
  const generation = useRef(0);
  const afterMenu = useRef<(() => void) | null>(null);
  useEffect(() => () => { generation.current += 1; }, []);
  const compose = () => {
    generation.current += 1;
    setError(null);
    setFocus((value) => value + 1);
    setOpen(true);
  };
  const close = () => { generation.current += 1; setOpen(false); };
  return <>
    <div className={cn(FLOATING, "flex h-8 shrink-0 items-center rounded-md text-sm text-muted-foreground")}>
      <button type="button" className="flex h-full items-center gap-1.5 rounded-l-md pr-2 pl-2.5 hover:bg-state-hover hover:text-foreground"
        title={threadId ? "Continue this page's conversation" : "Start a conversation about this page"}
        onClick={() => threadId ? openPageConversation(threadId, navigate) : compose()}>
        <Icon name="MessageSquare" className="size-4 shrink-0" /> Chat
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="Chat options" className="flex h-full shrink-0 items-center rounded-r-md px-1.5 hover:bg-state-hover hover:text-foreground">
            <Icon name="ChevronDown" className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onCloseAutoFocus={(event) => {
          const launch = afterMenu.current;
          afterMenu.current = null;
          if (launch) { event.preventDefault(); launch(); }
        }}>
          <DropdownMenuItem onSelect={() => { afterMenu.current = compose; }}>
            <Icon name="MessageSquarePlus" className="size-4" /> New conversation
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent className="max-w-[560px]">
        <DialogTitle>Chat about “{untitled(page.title)}”</DialogTitle>
        <DialogDescription>An agent works on this page with you. @mention a bot to hand it off.</DialogDescription>
        {error ? <p role="alert" className="text-sm text-red-500">{error}</p> : null}
        <NewThreadComposer className="pages-composer max-h-[60vh] min-h-0" layout="document"
          placeholder="Work with this page…" draftKey={`pages:${page.id}`} focusRequest={focus}
          {...(page.projectId ? { defaultProjectId: page.projectId } : {})}
          onSubmit={async (request) => {
            const submitted = generation.current;
            setError(null);
            try {
              const result = await rpc.call("work", { id: page.id, request });
              if (submitted !== generation.current) return;
              close();
              onStarted(result.threadId);
              openPageConversation(result.threadId, navigate);
            } catch (cause) {
              if (submitted === generation.current) setError(errorMessage(cause));
              throw cause;
            }
          }} />
      </DialogContent>
    </Dialog>
  </>;
}
