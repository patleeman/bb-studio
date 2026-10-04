import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { FloatPanels, retainPanel } from "@bb-studio/kit/app";
import { ChatOverlay } from "./src/ui/ChatOverlay";
import { ConversationPage } from "./src/ui/ConversationComposer";
import { CHAT_ICON, CHATS_PATH } from "./src/ui/conversation-drafts";

export function registerApp(app: import("@get-bb/plugin-sdk/app").PluginAppBuilder) {
  app.slots.experimental_appOverlay({ id: "chat", component: ChatOverlay });
  app.slots.navPanel({ id: CHATS_PATH, path: CHATS_PATH, title: "Chat", icon: CHAT_ICON, component: retainPanel(CHATS_PATH, ConversationPage) });
  app.slots.experimental_appOverlay({ id: "conversation-companions", component: () => <FloatPanels path={CHATS_PATH} render={subPath => <ConversationPage subPath={subPath} />} /> });
}

export default definePluginApp(registerApp);
