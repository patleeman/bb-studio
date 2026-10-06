// An artifact version's contents, shown by type. HTML runs in a sandboxed
// frame with an opaque origin (the content route also sends a sandbox CSP);
// images, PDFs and text use the browser's and BB's own viewers. Dragging over
// an image picks an area to send to the artifact's thread.
import { useEffect, useState } from "react";
import { EmptyState, Icon, OUTLINE_BUTTON, cn } from "@bb-studio/kit/app";
import { errorMessage } from "@bb-studio/kit/format";
import { Markdown, experimental_SourceCode as SourceCode, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { contentUrl, formatBytes, isTextType, type ArtifactType } from "../src/shared";
import { AreaBox, useImageArea, type Picked } from "./artifact-quote";

export type ArtifactVersion = {
  id: string;
  number: number;
  name: string;
  size: number;
  type: ArtifactType;
};

/** "preview" renders Markdown and HTML; "source" shows their text. */
export type BodyView = "preview" | "source";

const SPIN = "animate-spin motion-reduce:animate-none";

type Text = { text: string | null; truncated: boolean } | { error: string } | null;

function useVersionText(artifactId: string, version: ArtifactVersion, wanted: boolean, retry: number): Text {
  const rpc = useRpc<typeof rpcContract>();
  const [text, setText] = useState<Text>(null);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    setText(null);
    rpc.call("text", { id: artifactId, versionId: version.id }).then(
      (result) => live && setText(result),
      (error) => live && setText({ error: errorMessage(error) }),
    );
    return () => {
      live = false;
    };
  }, [rpc, artifactId, version.id, wanted, retry]);
  return text;
}

export function ArtifactBody({
  artifactId,
  version,
  view,
  dense = false,
  onArea,
}: {
  artifactId: string;
  version: ArtifactVersion;
  view: BodyView;
  /** Smaller padding, for a preview in a chat card. */
  dense?: boolean;
  /** An area of an image was picked. */
  onArea?: (picked: Picked) => void;
}) {
  const src = contentUrl(artifactId, version.id);
  const [retry, setRetry] = useState(0);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const showText = isTextType(version.type) && (version.type !== "html" || view === "source");
  const text = useVersionText(artifactId, version, showText, retry);
  const [actualSize, setActualSize] = useState(false);
  const area = useImageArea(`version ${version.number}`, (picked) => onArea?.(picked));
  const retryPreview = () => { setFailedImage(null); setRetry((value) => value + 1); };
  const recoveryActions = <div className="flex flex-wrap justify-center gap-2">
    <button type="button" className={OUTLINE_BUTTON} onClick={retryPreview}>Retry preview</button>
    <DownloadButton artifactId={artifactId} version={version} />
  </div>;

  if (version.type === "image") {
    if (failedImage === src) return <EmptyState icon="AlertTriangle" title="Couldn't display this image" actions={recoveryActions}>
      The image could not be loaded or decoded. Retry, or download the original file to open it elsewhere.
    </EmptyState>;
    return (
      <div className={cn("flex h-full min-h-0 overflow-auto bg-muted/40", dense ? "p-3" : "p-6 max-md:p-3", actualSize ? "" : "items-center justify-center")}>
        <img
          key={`${src}:${retry}`}
          src={retry ? `${src}&previewRetry=${retry}` : src}
          alt={version.name}
          title={`${actualSize ? "Click to fit to window" : "Click for actual size"}${onArea ? "; drag to send an area to the thread" : ""}`}
          onClick={() => setActualSize((current) => !current)}
          {...(onArea ? area.imgProps : {})}
          onError={() => setFailedImage(src)}
          className={cn(
            "rounded-sm shadow-sm select-none",
            actualSize ? "m-auto max-w-none cursor-zoom-out" : "max-h-full max-w-full cursor-zoom-in object-contain",
            onArea && area.box && "cursor-crosshair",
          )}
        />
        <AreaBox box={area.box} />
      </div>
    );
  }
  if (version.type === "html" && view === "preview") {
    return (
      <iframe
        key={version.id}
        title={version.name}
        src={contentUrl(artifactId, version.id, { quote: true })}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        className="size-full border-0 bg-white"
      />
    );
  }
  if (version.type === "pdf") {
    // Chrome's PDF viewer won't load in a sandboxed frame; the route only
    // serves a real PDF unsandboxed.
    return <iframe key={version.id} title={version.name} src={src} className="size-full border-0 bg-muted/40" />;
  }
  if (!showText) {
    return (
      <EmptyState icon="File" title={version.name} actions={<DownloadButton artifactId={artifactId} version={version} />}>
        {formatBytes(version.size)}. BB can't show this kind of file here; download it to open it.
      </EmptyState>
    );
  }
  if (!text) {
    return (
      <div role="status" className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Icon name="Loading" className={cn("size-4", SPIN)} /> Loading…
      </div>
    );
  }
  if ("error" in text) {
    return <EmptyState icon="AlertTriangle" title="Couldn't load this artifact" actions={recoveryActions}>{text.error}</EmptyState>;
  }
  if (text.text === null) {
    return <EmptyState icon="AlertTriangle" title="File content is unavailable" actions={recoveryActions}>
      This version's file could not be found. Retry after restoring the file or choose another version.
    </EmptyState>;
  }
  const truncated = text.truncated ? (
    <p className="border-b border-border/70 bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
      This file is large, so only its start is shown. Download it for the rest.
    </p>
  ) : null;
  if (version.type === "markdown" && view === "preview") {
    return (
      <div className="h-full min-h-0 overflow-auto">
        {truncated}
        <div className={dense ? "px-4 py-3 text-sm" : "mx-auto w-full max-w-3xl px-10 py-10 max-md:px-5 max-md:py-6"}>
          <Markdown content={text.text ?? ""} />
        </div>
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      {truncated}
      <div className="min-h-0 flex-1 overflow-auto">
        <SourceCode content={text.text ?? ""} path={version.name} overflow="wrap" className="min-h-full" />
      </div>
    </div>
  );
}

export function DownloadButton({ artifactId, version }: { artifactId: string; version: ArtifactVersion }) {
  return (
    <a className={OUTLINE_BUTTON} href={contentUrl(artifactId, version.id, { download: true })} download={version.name}>
      <Icon name="Download" className="size-4" /> Download
    </a>
  );
}
