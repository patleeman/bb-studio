import { untitled } from "@bb-studio/kit/format";
import { ChatButton, NewConversationComposer, useOpenCompanion } from "@bb-studio/kit/app";
import type { PageMetaView } from "../contract";
import type { Rpc } from "./shared";

export const pageConversationPath = (pageId: string) => `/plugins/pages/pages/${encodeURIComponent(pageId)}/compose`;

export function PageChat({ page, threadId }: { page: PageMetaView; threadId: string | null }) {
  const open = useOpenCompanion();
  const compose = () => open({ kind: "path", path: pageConversationPath(page.id), title: `Chat: ${untitled(page.title)}`, icon: "MessageSquare" });
  return <ChatButton
    title={threadId ? "Continue this page's conversation" : "Start a conversation about this page"}
    onOpen={() => threadId ? open({ kind: "thread", threadId }) : compose()}
    items={[{ label: "New conversation", icon: "MessageSquarePlus", onSelect: compose }]}
  />;
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
