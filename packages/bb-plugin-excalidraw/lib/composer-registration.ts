import type { ComposerCustomization, PluginComposerScope } from "@get-bb/plugin-sdk/app";
import { DRAW_ICON } from "../src/shared";

export function createExcalidrawComposerCustomization(
  run: (scope: PluginComposerScope) => void,
): ComposerCustomization {
  return {
    id: "excalidraw-attach",
    scopes: ["thread", "new-thread"],
    plusMenu: [
      {
        id: "excalidraw",
        label: "Drawing",
        icon: DRAW_ICON,
        description: "Attach a drawing to this conversation as an image",
        disabled: (view) => view.scope.kind !== "thread",
        run: ({ view }) => run(view.scope),
      },
    ],
  };
}
