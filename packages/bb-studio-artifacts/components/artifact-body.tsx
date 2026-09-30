// An artifact version's contents, shown by type. HTML runs in a sandboxed
// frame with an opaque origin (the content route also sends a sandbox CSP);
// images, PDFs and text use the browser's and BB's own viewers.
import { useEffect, useState } from "react";
import { EmptyState, Icon, OUTLINE_BUTTON, cn } from "@bb-studio/kit/app";
import { errorMessage } from "@bb-studio/kit/format";
import { Markdown, experimental_SourceCode as SourceCode, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { contentUrl, formatBytes, isTextType, type ArtifactType } from "../src/shared";

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

function useVersionText(artifactId: string, version: ArtifactVersion, wanted: boolean): Text {
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
  }, [rpc, artifactId, version.id, wanted]);
  return text;
}

export function ArtifactBody({ artifactId, version, view }: { artifactId: string; version: ArtifactVersion; view: BodyView }) {
  const src = contentUrl(artifactId, version.id);
  const showText = isTextType(version.type) && (version.type !== "html" || view === "source");
  const text = useVersionText(artifactId, version, showText);
  const [actualSize, setActualSize] = useState(false);

  if (version.type === "image") {
    return (
      <div className={cn("flex h-full min-h-0 overflow-auto bg-muted/40 p-6 max-md:p-3", actualSize ? "" : "items-center justify-center")}>
        <img
          src={src}
          alt={version.name}
          title={actualSize ? "Fit to window" : "Actual size"}
          onClick={() => setActualSize((current) => !current)}
          className={cn(
            "rounded-sm shadow-sm",
            actualSize ? "m-auto max-w-none cursor-zoom-out" : "max-h-full max-w-full cursor-zoom-in object-contain",
          )}
        />
      </div>
    );
  }
  if (version.type === "html" && view === "preview") {
    return (
      <iframe
        key={version.id}
        title={version.name}
        src={src}
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
    return <EmptyState icon="AlertTriangle" title="Couldn't load this artifact">{text.error}</EmptyState>;
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
        <div className="mx-auto w-full max-w-3xl px-10 py-10 max-md:px-5 max-md:py-6">
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
