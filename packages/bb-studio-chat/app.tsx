// bb-studio-chat frontend: the floating chat over every window and
// commands to toggle and float.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { ChatOverlay } from "./src/ui/ChatOverlay";
import { floatThread, toggleChat } from "./src/ui/store";

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "chat", component: ChatOverlay });
  app.commands.register({
    id: "toggle",
    title: "Studio Chat: show or hide",
    defaultShortcut: { key: "j", mod: true, shift: true },
    run: toggleChat,
  });
  app.commands.register({
    id: "float",
    title: "Studio Chat: float this thread",
    isAvailable: ({ threadId }) => Boolean(threadId),
    run: ({ threadId }) => {
      if (threadId) floatThread(threadId);
    },
  });
});
