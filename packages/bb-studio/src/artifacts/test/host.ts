import { MIGRATIONS } from "../../migrations";
import { StudioServices } from "../../services";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { registerArtifacts } from "../server";
import { ARTIFACT_LIVE_TABLES } from "../live/store";
import { ARTIFACT_TABLES } from "../server/store";

/** Studio on a fake host with only its artifacts registered. */
export function artifactsHost() {
  const host = createFakePluginHost({ pluginId: "studio" });
  const db = host.bb.storage.database();
  db.exec(MIGRATIONS[0]!);
  db.exec(ARTIFACT_TABLES);
  db.exec(ARTIFACT_LIVE_TABLES);
  const artifacts = registerArtifacts(host.bb, db, new StudioServices(db));
  host.bb.onDispose(() => artifacts.dispose());
  return { ...host, artifacts };
}
