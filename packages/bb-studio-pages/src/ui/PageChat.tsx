import { untitled } from "@bb-studio/kit/format";
import { NewConversationComposer, useOpenCompanion } from "@bb-studio/kit/app";
import { useRef } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Icon } from "@bb-studio/kit/ui";
import type { PageMetaView } from "../contract";
import type { Rpc } from "./shared";

export const pageConversationPath = (pageId: string) => `/plugins/pages/pages/${encodeURIComponent(pageId)}/compose`;

export function PageChat({ page, threadId }: { page: PageMetaView; threadId: string | null }) {
  const open = useOpenCompanion();
  const afterMenu = useRef<(() => void) | null>(null);
  const compose = () => open({ kind: "path", path: pageConversationPath(page.id), title: `Chat: ${untitled(page.title)}`, icon: "MessageSquare" });
  return <div className="flex h-7 shrink-0 items-center rounded-md text-sm text-muted-foreground">
    <button type="button" className="flex h-full items-center gap-1.5 rounded-l-md pr-1.5 pl-2 hover:bg-state-hover hover:text-foreground"
      title={threadId ? "Continue this page's conversation" : "Start a conversation about this page"}
      onClick={() => threadId ? open({ kind: "thread", threadId }) : compose()}>
      <Icon name="MessageSquare" className="size-4 shrink-0" /> Chat
    </button>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Chat options" className="flex h-full shrink-0 items-center rounded-r-md px-1 hover:bg-state-hover hover:text-foreground data-[state=open]:bg-state-active">
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
  </div>;
}

export function PageConversation({ page, rpc }: { page: PageMetaView; rpc: Rpc }) {
  const open = useOpenCompanion();
  return <NewConversationComposer title={`Chat about "${untitled(page.title)}"`} placeholder="Work with this page…"
    composerClassName="pages-composer" draftKey={`pages:${page.id}`} focusRequest={1}
    {...(page.projectId ? { defaultProjectId: page.projectId } : {})}
    onSubmit={async request => {
      const { threadId } = await rpc.call("work", { id: page.id, request });
      open({ kind: "thread", threadId });
    }} />;
}
