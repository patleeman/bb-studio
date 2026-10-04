import { moduleApp } from "./src/modules/app";
import { registerApp as registerTalk } from "./src/modules/talk/app";
import { registerApp as registerDecisions } from "./src/modules/decisions/app";
import { registerApp as registerArtifacts } from "./src/modules/artifacts/app";
import { registerApp as registerTeams } from "./src/modules/teams/app";
import { registerApp as registerTasks } from "./src/modules/tasks/app";
import { registerApp as registerFeed } from "./src/modules/feed/app";
import { ModuleNotice } from "./src/modules/Notice";
import { registerApp as registerTables } from "./src/modules/tables/app";
import { registerApp as registerChat } from "./src/modules/chat/app";
// bb-studio frontend: the work UI (Projects and Threads in the sidebar, a
// project's lead with its page beside it, the Inbox), the Library, and the
// modules whose panels open Studio items by link.
import { FloatPanels, retainPanel } from "@bb-studio/kit/app";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { StudioPanel } from "./src/ui/StudioPanel";
import { ComposerTrim } from "./src/ui/ComposerTrim";
import { ActivityPanel } from "./src/ui/HomePanel";
import { registerWork } from "./src/ui/work/register";

function StudioRoot({ subPath }: { subPath: string }) {
  const path = subPath.replace(/^\/+|\/+$/g, "");
  // "collection" is the old address of the landing page.
  return path === "activity" ? <ActivityPanel /> : <StudioPanel subPath={path} />;
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "module-import-notice", component: ModuleNotice });
  registerTalk(app);
  registerDecisions(app);
  registerArtifacts(app);
  registerTeams(app);
  registerTasks(app);
  registerFeed(app);
  registerTables(app);
  registerChat(app);
  // The work UI replaces the folded Sidebar and Navigation modules, gated the same way they were.
  registerWork(app, { sidebar: moduleApp(app, "sidebar"), navigation: moduleApp(app, "navigation") });
  app.slots.navPanel({ id: "studio", title: "Library", icon: "studio/studio", path: "studio", component: retainPanel("studio", StudioRoot) });
  // Shows the panel in Float windows open on its paths.
  app.slots.experimental_appOverlay({ id: "float", component: () => <FloatPanels path="studio" render={(subPath) => <StudioRoot subPath={subPath} />} /> });
  // Collapses the row under the composer into a ⋯ menu.
  app.composer.customize({ id: "composer-trim", scopes: ["thread"], actions: [{ id: "trim", component: ComposerTrim }] });
});
