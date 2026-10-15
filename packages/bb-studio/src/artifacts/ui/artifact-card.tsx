// `::artifact{id="art_…"}` in a reply: a card for a saved artifact that opens
// its viewer in the thread's workbench, beside the chat. Files BB can show
// are previewed inline, as in the viewer.
import { useCallback, useEffect, useState } from "react";
import { ItemDirectiveCard, remember, openAppPath } from "@bb-studio/kit/app";
import { useBbNavigate, useRealtime, useRpc, type PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import type { z } from "zod";
import type { rpcContract } from "../contract";
import { ArtifactBody } from "./artifact-body";
import { ARTIFACT_ICON, ARTIFACT_UPDATE_TYPE, REALTIME_CHANNEL, artifactHref, TYPE_ICONS, TYPE_LABELS, formatBytes, isArtifactId } from "../shared";
import { itemParams, STUDIO_TAB } from "../../ui/studio-tab/model";

type Artifact = NonNullable<z.infer<(typeof rpcContract)["artifacts.get"]["output"]>["artifact"]>;

export function ArtifactCard({ attributes, message }: PluginMessageDirectiveProps) {
  const id = attributes.id ?? "";
  const valid = isArtifactId(id);
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [loaded, setArtifact] = useState<Artifact | null | undefined>(undefined);
  const artifact = remember(`artifact:${id}`, valid ? loaded : null);

  const load = useCallback(() => {
    if (!valid) return;
    rpc.call("artifacts.get", { id }).then(
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
        if (!navigate.openThreadPanel({ actionId: STUDIO_TAB, title: artifact.title, params: itemParams("artifact", artifact.id) }))
          openAppPath(artifactHref(artifact.id));
      }}
      body={version.type === "other" ? undefined : (
        // A player is a row high and an HTML page fits its height; other previews get room.
        <div className={version.type === "audio" || version.type === "html" ? "" : "h-80"}>
          <ArtifactBody artifactId={artifact.id} version={version} view="preview" dense threadId={message.threadId} />
        </div>
      )}
      details={<>{TYPE_LABELS[version.type]} · {formatBytes(version.size)}{artifact.versions > 1 ? ` · v${version.number}` : ""} · Saved to Studio</>}
    />
  );
}
