// `::artifact{id="art_…"}` in a reply: a card for a saved artifact that opens
// its viewer in the thread's workbench, beside the chat. Images show a preview.
import { useCallback, useEffect, useState } from "react";
import { ItemDirectiveCard } from "@bb-studio/kit/app";
import { useBbNavigate, useRealtime, useRpc, type PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import type { z } from "zod";
import type { rpcContract } from "../server";
import { ARTIFACT_ICON, ARTIFACTS_TAB, ARTIFACT_UPDATE_TYPE, PANEL_PATH, REALTIME_CHANNEL, TYPE_ICONS, TYPE_LABELS, contentUrl, formatBytes, isArtifactId } from "../src/shared";

type Artifact = NonNullable<z.infer<(typeof rpcContract)["get"]["output"]>["artifact"]>;

export function ArtifactCard({ attributes }: PluginMessageDirectiveProps) {
  const id = attributes.id ?? "";
  const valid = isArtifactId(id);
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [artifact, setArtifact] = useState<Artifact | null | undefined>(undefined);

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
  const image = version.type === "image";
  return (
    <ItemDirectiveCard
      state="ready"
      kind="artifact"
      icon={TYPE_ICONS[version.type]}
      title={artifact.title}
      onOpen={() => {
        // The workbench when there is one; the main area otherwise.
        if (!navigate.openThreadPanel({ actionId: ARTIFACTS_TAB, title: artifact.title, params: { artifactId: artifact.id } }))
          navigate.toPluginPanel(PANEL_PATH, { subPath: artifact.id });
      }}
      preview={image ? (
        <div className="flex max-h-64 w-full items-center justify-center overflow-hidden border-b border-border/70 bg-muted/40">
          <img src={contentUrl(artifact.id, version.id)} alt={artifact.title} loading="lazy" className="max-h-64 max-w-full object-contain" />
        </div>
      ) : undefined}
      details={<>{TYPE_LABELS[version.type]} · {formatBytes(version.size)}{artifact.versions > 1 ? ` · v${version.number}` : ""} · Saved to Studio</>}
    />
  );
}
