// `::mini{id="mini_…"}` in a reply: the mini app itself, live, where a
// playground would have been. It keeps working after the turn, shares its
// data with every other place it shows, and opens beside the chat.
import { useBbNavigate, type PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { lazy, Suspense } from "react";
import { openAppPath } from "../../kit/app/index";
import { itemParams, STUDIO_TAB } from "../../ui/studio-tab/model";
import { isMiniId, miniHref } from "../shared";

const MiniEmbed = lazy(() => import("./mini-view").then((module) => ({ default: module.MiniEmbed })));

export function MiniCard({ attributes, message }: PluginMessageDirectiveProps) {
  const id = attributes.id ?? "";
  const navigate = useBbNavigate();
  if (!isMiniId(id)) return null;
  const open = () => {
    if (!navigate.openThreadPanel({ actionId: STUDIO_TAB, title: "Mini app", params: itemParams("mini", id) })) openAppPath(miniHref(id));
  };
  return (
    <div className="my-2">
      <Suspense fallback={<div className="h-24 animate-pulse rounded-lg border border-border/70 bg-muted/40" />}>
        <MiniEmbed miniId={id} threadId={message.threadId} onOpen={open} />
      </Suspense>
    </div>
  );
}
