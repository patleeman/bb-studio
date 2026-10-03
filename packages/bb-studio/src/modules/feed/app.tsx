import { moduleApp } from "../app";
// Studio Feed — frontend entry.
//
// Surfaces:
//   - navPanel "Feed": every post, newest first, and a post's page at
//     feed/<id>. New stories since you last looked show next to it.
//   - messageDirective `::post{id="…"}`: the post a reply made, as a
//     card in its thread or channel.
import { FloatPanels, retainPanel } from "@bb-studio/kit/app";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { DIRECTIVE, FEED_ICON, PANEL_PATH } from "./src/shared";
import { PostCard } from "./src/ui/card";
import { FeedPanel, UnreadCount } from "./src/ui/reader";

export function registerApp(host: import("@get-bb/plugin-sdk/app").PluginAppBuilder) {
  const app = moduleApp(host, "feed");
  app.slots.navPanel({
    id: "feed",
    title: "Feed",
    icon: FEED_ICON,
    path: PANEL_PATH,
    component: retainPanel(PANEL_PATH, FeedPanel),
    experimental_sidebarAccessory: UnreadCount,
  });
  // Shows the panel in Float windows open on its paths.
  app.slots.experimental_appOverlay({ id: "feed-float", component: () => <FloatPanels path={PANEL_PATH} render={(subPath) => <FeedPanel subPath={subPath} />} /> });
  app.slots.messageDirective({ id: DIRECTIVE, component: PostCard });
}

export default definePluginApp(registerApp);
