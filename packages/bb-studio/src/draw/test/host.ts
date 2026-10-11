import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { registerDraw } from "../server";
import { DRAWING_TABLES } from "../server/store";

/** Studio on a fake host with only its drawings registered. Studio's other calls fail, as when it's busy. */
export function drawHost() {
  const host = createFakePluginHost({ pluginId: "studio", sdk: {
    plugins: { callRpc: async () => { throw new Error("not in this test"); } },
  } });
  const db = host.bb.storage.database();
  db.exec(DRAWING_TABLES);
  const drawings = registerDraw(host.bb, db);
  host.bb.onDispose(() => drawings.dispose());
  return { ...host, drawings };
}
