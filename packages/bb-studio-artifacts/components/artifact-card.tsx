// `::artifact{id="art_…"}` in a reply: a card for a saved artifact that opens
// its viewer in the thread's workbench, beside the chat. Files BB can show
// are previewed inline, as in the viewer.
import { useCallback, useEffect, useState } from "react";
import { ItemDirectiveCard, remember, openAppPath } from "@bb-studio/kit/app";
import { useBbNavigate, useRealtime, useRpc, type PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import type { z } from "zod";
import type { rpcContract } from "../server";
import { ArtifactBody } from "./artifact-body";
import { ARTIFACT_ICON, ARTIFACTS_TAB, ARTIFACT_UPDATE_TYPE, PANEL_PATH, REALTIME_CHANNEL, TYPE_ICONS, TYPE_LABELS, formatBytes, isArtifactId } from "../src/shared";

type Artifact = NonNullable<z.infer<(typeof rpcContract)["get"]["output"]>["artifact"]>;

export function ArtifactCard({ attributes }: PluginMessageDirectiveProps) {
  const id = attributes.id ?? "";
  const valid = isArtifactId(id);
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [loaded, setArtifact] = useState<Artifact | null | undefined>(undefined);
  const artifact = remember(`artifact:${id}`, valid ? loaded : null);

  const load = useCallback(() => {
    if (!valid) return;
    rpc.call("get", { id }).then(
      (result) => setArtifact(result.artifact),
      () => setArtifact(null),
    );
  }, [rpc, id, valid]);
  useEffect(load, [load]);
  useRealtime(REALTIME_CHANNEL, (payload) => {
    const event = payload as { type?: string; artifactId?: string } | null;
    if (event?.type === ARTIFACT_UPDATE_TYPE && event.artifactId === id) load();
  });

  if (!valid || artifact === null) return <ItemDirectiveCard state="deleted" kind="artifact" icon={ARTIFACT_ICON} />;
  if (!artifact) return <ItemDirectiveCard state="loading" kind="artifact" icon={ARTIFACT_ICON} />;

  const { version } = artifact;
  return (
    <ItemDirectiveCard
      state="ready"
      kind="artifact"
      icon={TYPE_ICONS[version.type]}
      title={artifact.title}
      onOpen={() => {
        // The workbench when there is one; the main area otherwise.
        if (!navigate.openThreadPanel({ actionId: ARTIFACTS_TAB, title: artifact.title, params: { artifactId: artifact.id } }))
          openAppPath(`/plugins/artifacts/${PANEL_PATH}/${encodeURIComponent(artifact.id)}`);
      }}
      body={version.type === "other" ? undefined : (
        <div className="h-80">
          <ArtifactBody artifactId={artifact.id} version={version} view="preview" dense />
        </div>
      )}
      details={<>{TYPE_LABELS[version.type]} · {formatBytes(version.size)}{artifact.versions > 1 ? ` · v${version.number}` : ""} · Saved to Studio</>}
    />
  );
}
