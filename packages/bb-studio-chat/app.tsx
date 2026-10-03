import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { FloatPanels } from "@bb-studio/kit/app";
import { ChatOverlay } from "./src/ui/ChatOverlay";
import { ConversationPage } from "./src/ui/ConversationComposer";
import { CHATS_PATH } from "./src/ui/conversation-drafts";

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "chat", component: ChatOverlay });
  app.slots.navPanel({ id: CHATS_PATH, path: CHATS_PATH, title: "Chat", icon: "MessageCircle", component: ConversationPage });
  app.slots.experimental_appOverlay({ id: "conversation-companions", component: () => <FloatPanels path={CHATS_PATH} render={subPath => <ConversationPage subPath={subPath} />} /> });
});
