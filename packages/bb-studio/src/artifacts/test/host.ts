import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { registerArtifacts } from "../server";
import { ARTIFACT_TABLES } from "../server/store";

/** Studio on a fake host with only its artifacts registered. */
export function artifactsHost() {
  const host = createFakePluginHost({ pluginId: "studio" });
  const db = host.bb.storage.database();
  db.exec(ARTIFACT_TABLES);
  const artifacts = registerArtifacts(host.bb, db);
  host.bb.onDispose(() => artifacts.dispose());
  return { ...host, artifacts };
}
