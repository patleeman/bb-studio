// `::artifact{id="art_…"}` in a reply: a card for a saved artifact that opens
// its viewer. Images show a preview.
import { useCallback, useEffect, useState } from "react";
import { Icon, cn } from "@bb-studio/kit/app";
import { useBbNavigate, useRealtime, useRpc, type PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import type { z } from "zod";
import type { rpcContract } from "../server";
import { ARTIFACT_UPDATE_TYPE, PANEL_PATH, REALTIME_CHANNEL, TYPE_ICONS, TYPE_LABELS, contentUrl, formatBytes, isArtifactId } from "../src/shared";

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

  if (!valid || artifact === null) {
    return (
      <div className="my-2 flex items-center gap-2 rounded-lg border border-border/70 px-3 py-2 text-sm text-muted-foreground">
        <Icon name="File" className="size-4" /> This artifact was deleted.
      </div>
    );
  }
  if (!artifact) {
    return <div className="my-2 h-14 max-w-md animate-pulse rounded-lg border border-border/70 bg-muted/40 motion-reduce:animate-none" />;
  }

  const { version } = artifact;
  const image = version.type === "image";
  return (
    <button
      type="button"
      onClick={() => navigate.toPluginPanel(PANEL_PATH, { subPath: artifact.id })}
      className={cn(
        "group my-2 flex w-full max-w-md flex-col overflow-hidden rounded-lg border border-border/70 bg-background text-left hover:border-border hover:bg-state-hover",
      )}
    >
      {image ? (
        <div className="flex max-h-64 w-full items-center justify-center overflow-hidden border-b border-border/70 bg-muted/40">
          <img src={contentUrl(artifact.id, version.id)} alt={artifact.title} loading="lazy" className="max-h-64 max-w-full object-contain" />
        </div>
      ) : null}
      <div className="flex w-full items-center gap-3 px-3 py-2.5">
        {image ? null : (
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Icon name={TYPE_ICONS[version.type]} className="size-4" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{artifact.title}</div>
          <div className="truncate text-xs text-muted-foreground">
            {TYPE_LABELS[version.type]} · {formatBytes(version.size)}
            {artifact.versions > 1 ? ` · v${version.number}` : ""} · Saved to Studio
          </div>
        </div>
        <Icon name="ArrowUpRight" className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
      </div>
    </button>
  );
}
