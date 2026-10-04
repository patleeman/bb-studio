// Studio Feed — frontend entry.
//
// Surfaces:
//   - navPanel "Inbox": threads waiting on you, then every post, newest
//     first, and a post's page at feed/<id>. Waiting threads plus unread
//     stories show next to it.
//   - messageDirective `::post{id="…"}`: the post a reply made, as a
//     card in its thread or channel.
import { FloatPanels, retainPanel, StudioBarSlot } from "@bb-studio/kit/app";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { DIRECTIVE, INBOX_ICON, INBOX_TITLE, PANEL_PATH } from "./src/shared";
import { PostCard } from "./src/ui/card";
import { FeedPanel, UnreadCount } from "./src/ui/reader";

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "feed",
    title: INBOX_TITLE,
    icon: INBOX_ICON,
    path: PANEL_PATH,
    component: retainPanel(PANEL_PATH, FeedPanel),
    headerContent: StudioBarSlot,
    experimental_sidebarAccessory: UnreadCount,
  });
  // Shows the panel in Float windows open on its paths.
  app.slots.experimental_appOverlay({ id: "float", component: () => <FloatPanels path={PANEL_PATH} render={(subPath) => <FeedPanel subPath={subPath} />} /> });
  app.slots.messageDirective({ id: DIRECTIVE, component: PostCard });
});
