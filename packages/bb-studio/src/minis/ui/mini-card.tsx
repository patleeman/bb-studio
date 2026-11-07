// `::mini{id="mini_…"}` in a reply: the mini app itself, live, where a
// playground would have been. It keeps working after the turn, shares its
// data with every other place it shows, and opens beside the chat.
import { type PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { lazy, Suspense } from "react";
import { useStudioOpen } from "../../ui/studio-open";
import { isMiniId, miniHref } from "../shared";

const MiniEmbed = lazy(() => import("./mini-view").then((module) => ({ default: module.MiniEmbed })));

export function MiniCard({ attributes, message }: PluginMessageDirectiveProps) {
  const id = attributes.id ?? "";
  // In its thread's workbench (src/ui/studio-open.tsx).
  const openItem = useStudioOpen({ kind: "thread", threadId: message.threadId });
  if (!isMiniId(id)) return null;
  const open = () => openItem({ href: miniHref(id), title: "Mini app" });
  return (
    <div className="my-2">
      <Suspense fallback={<div className="h-24 animate-pulse rounded-lg border border-border/70 bg-muted/40" />}>
        <MiniEmbed miniId={id} threadId={message.threadId} onOpen={open} />
      </Suspense>
    </div>
  );
}
