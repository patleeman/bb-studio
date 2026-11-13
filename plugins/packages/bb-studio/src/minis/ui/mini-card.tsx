// `::mini{id="mini_…"}` in a reply: the mini app itself, live, where a
// playground would have been. It keeps working after the turn, shares its
// data with every other place it shows, and opens beside the chat.
import { type PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { lazy, Suspense } from "react";
import { useOpenCard } from "../../links/open";
import { CHAT_CARD_SKELETON, cn } from "../../kit/app/index";
import { isMiniId, miniHref } from "../shared";

const MiniEmbed = lazy(() => import("./mini-view").then((module) => ({ default: module.MiniEmbed })));

export function MiniCard({ attributes, message }: PluginMessageDirectiveProps) {
  const id = attributes.id ?? "";
  // In its thread's workbench, by the link router's rule (src/links/router.ts).
  const openCard = useOpenCard(message.threadId);
  if (!isMiniId(id)) return null;
  const open = openCard(miniHref(id), "App");
  return (
    <div className="my-2">
      <Suspense fallback={<div className={cn(CHAT_CARD_SKELETON, "my-0 h-24")} />}>
        <MiniEmbed miniId={id} threadId={message.threadId} onOpen={open} />
      </Suspense>
    </div>
  );
}
