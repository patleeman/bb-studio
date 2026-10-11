import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { registerTalk, TALK_SETTINGS } from "../server";
import { MIGRATIONS } from "../server/store";

/** Studio on a fake host with only its recordings registered. Studio's other calls fail, as when it's busy. */
export async function talkHost() {
  const host = createFakePluginHost({ pluginId: "studio", sdk: {
    plugins: { callRpc: async () => { throw new Error("not in this test"); } },
  } });
  const db = host.bb.storage.database();
  for (const statement of MIGRATIONS) db.exec(statement);
  const talk = await registerTalk(host.bb, db, host.bb.settings.define(TALK_SETTINGS));
  host.bb.onDispose(() => talk.dispose());
  const call = (method: string, input: unknown): Promise<any> => host.harness.behavior.callRpc(method, input);
  return { ...host, db, talk, call };
}
