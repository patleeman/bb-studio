import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { DIRECTIVE } from "./src/shared";
import { ExploreDirective } from "./src/ui/rows";
import { ComposerBridge } from "@bb-studio/kit/composer";
import { NextDirective } from "./src/ui/next";
import { NEXT_DIRECTIVE } from "./src/next";

export function registerExploreApp(app: PluginAppBuilder) {
  // "Along the way" findings at the end of a reply.
  app.slots.messageDirective({ id: DIRECTIVE, component: ExploreDirective });
  // The Next row: replies, things to explore and actions in one line at the end of a reply.
  app.slots.messageDirective({ id: NEXT_DIRECTIVE, component: NextDirective });
  // Lets the Next row draft into the composer of the message's thread. Renders nothing.
  app.composer.customize({ id: "next-composer", banners: [{ id: "composer-bridge", chrome: "bare", component: ComposerBridge }] });
}
