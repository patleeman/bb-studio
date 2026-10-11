import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { registerDesign } from "../server";
import { DESIGN_MIGRATIONS } from "../server/store";

/** Studio on a fake host with only its designs registered. Studio's other calls fail, as when it's busy. */
export function designHost() {
  const host = createFakePluginHost({ pluginId: "studio", sdk: {
    plugins: { callRpc: async () => { throw new Error("not in this test"); } },
  } });
  const db = host.bb.storage.database();
  for (const statement of DESIGN_MIGRATIONS) db.exec(statement);
  const designs = registerDesign(host.bb, db);
  host.bb.onDispose(() => designs.dispose());
  return { ...host, designs };
}
