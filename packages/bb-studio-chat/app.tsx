import { definePluginApp, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { FloatPanels, openAppPath, panelHref, retainPanel, useStudioPresent } from "@bb-studio/kit/app";
import { useEffect } from "react";

/** Old bookmarks and restored Float tabs reach Studio's retained composers. */
function LegacyChat({ subPath }: { subPath: string }) {
  const navigate = useBbNavigate();
  const present = useStudioPresent();
  useEffect(() => { if (present) openAppPath(panelHref("studio", "chats", subPath)); }, [navigate, present, subPath]);
  return <p className="p-4 text-sm text-muted-foreground">Chat is now part of Studio. Update and enable Studio to continue.</p>;
}

export default definePluginApp(app => {
  app.slots.experimental_appOverlay({ id: "legacy-chat-routes", component: () => <FloatPanels path="chats" render={subPath => <LegacyChat subPath={subPath} />} /> });
  app.slots.navPanel({ id: "chats", path: "chats", title: "Chat upgrade", icon: "MessageSquare", component: retainPanel("chats", LegacyChat) });
});
