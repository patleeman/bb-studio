// bb-studio-chat frontend: "Work with this…" on every Studio item, with its
// threads opening in Float's windows.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { ChatOverlay } from "./src/ui/ChatOverlay";

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "chat", component: ChatOverlay });
});
