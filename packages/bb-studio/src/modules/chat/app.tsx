import { moduleComponent } from "../Notice";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { FloatPanels, retainPanel } from "@bb-studio/kit/app";
import { ChatOverlay } from "./src/ui/ChatOverlay";
import { ConversationPage } from "./src/ui/ConversationComposer";
import { CHAT_ICON, CHATS_PATH } from "./src/ui/conversation-drafts";

export function registerApp(host: import("@get-bb/plugin-sdk/app").PluginAppBuilder) {
  const app = { ...host, slots: new Proxy(host.slots, { get(target, property) {
    const register = Reflect.get(target, property);
    if (typeof register !== "function") return register;
    return (registration: { component?: import("react").ComponentType<object> }) => register.call(target, registration.component ? { ...registration, component: moduleComponent("chat", registration.component) } : registration);
  } }) };
  app.slots.experimental_appOverlay({ id: "chat", component: ChatOverlay });
  app.slots.navPanel({ id: CHATS_PATH, path: CHATS_PATH, title: "Chat", icon: CHAT_ICON, component: retainPanel(CHATS_PATH, ConversationPage) });
  app.slots.experimental_appOverlay({ id: "conversation-companions", component: () => <FloatPanels path={CHATS_PATH} render={subPath => <ConversationPage subPath={subPath} />} /> });
}

export default definePluginApp(registerApp);
