// One artifact: its contents by type under Studio's item header, with its
// versions, the thread it came from, and Save as page for text. Selected text
// or an image area can go to the artifact's thread (artifact-quote.tsx).
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  GHOST_BUTTON,
  ICON_BUTTON,
  Icon,
  BarTitle,
  ItemHeader,
  ItemDeleteConfirm,
  ItemMenu,
  openNewItemThread,
  useStudioChatPresent,
  cn,
  openAppPath,
  projectName,
  useProjects,
} from "@bb-studio/kit/app";

import { errorMessage, relativeTime, shortDateTime } from "@bb-studio/kit/format";
import { useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { z } from "zod";
import type { rpcContract } from "../server";
import { ARTIFACT_UPDATE_TYPE, PLUGIN_ID, REALTIME_CHANNEL, TYPE_LABELS, artifactHref, contentUrl, formatBytes, isTextType } from "../src/shared";
import { ArtifactBody, type BodyView } from "./artifact-body";
import { QuoteCard, useSelectionPick, type Picked } from "./artifact-quote";

const SPIN = "animate-spin motion-reduce:animate-none";

type Loaded = z.infer<(typeof rpcContract)["get"]["output"]>;

export function ArtifactViewer({
  artifactId,
  backLabel,
  onBack,
}: {
  artifactId: string;
  backLabel: string;
  /** `replace` when leaving because the artifact is gone. */
  onBack: (replace?: boolean) => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  // Studio Chat's New in Float bar starts threads; the menu only offers it without one.
  const studioChat = useStudioChatPresent();
  const projects = useProjects();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** An older version being looked at; null follows the newest. */
  const [versionId, setVersionId] = useState<string | null>(null);
  const [view, setView] = useState<BodyView>("preview");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  /** Writing a note for the pick, which then stays put. */
  const [writing, setWriting] = useState(false);
  const shownVersion = loaded?.versions.find((each) => each.id === versionId) ?? loaded?.artifact?.version;
  const [picked, setPicked] = useSelectionPick(body, `version ${shownVersion?.number ?? 1}`, !writing);
  const pickArea = useCallback((area: Picked) => {
    setPicked(area);
    setWriting(true);
  }, [setPicked]);
  const closeQuote = useCallback(() => {
    setPicked(null);
    setWriting(false);
  }, [setPicked]);
  // A pick belongs to the contents it came from.
  useEffect(closeQuote, [closeQuote, versionId, view]);
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  /** Deleting here: remove() says so and goes back, not the realtime reload. */
  const deleting = useRef(false);

  const load = useCallback(
    () =>
      rpc.call("get", { id: artifactId }).then(
        (result) => {
          if (!result.artifact) {
            if (deleting.current) return;
            toast.info("This artifact was deleted.");
            onBackRef.current(true);
            return;
          }
          setLoaded(result);
          setError(null);
        },
        (failure) => setError(errorMessage(failure)),
      ),
    [rpc, artifactId],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useRealtime(REALTIME_CHANNEL, (payload) => {
    const event = payload as { type?: string; artifactId?: string } | null;
    if (event?.type === ARTIFACT_UPDATE_TYPE && event.artifactId === artifactId) void load();
  });

  if (!loaded?.artifact) {
    return (
      <div className="studio-root flex h-full min-h-0 flex-col bg-background text-foreground">
        <ItemHeader backLabel={backLabel} onBack={() => onBack()} />
        <div role="status" className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          {error ?? (
            <>
              <Icon name="Loading" className={cn("size-4", SPIN)} /> Loading artifact…
            </>
          )}
        </div>
      </div>
    );
  }

  const { artifact, versions } = loaded;
  const latest = artifact.version;
  const version = versions.find((each) => each.id === versionId) ?? latest;
  const older = version.id !== latest.id;
  const text = isTextType(version.type);
  const canToggle = version.type === "markdown" || version.type === "html";

  function rename(next: string) {
    const title = next.trim();
    if (!title || title === artifact.title) return;
    void rpc.call("update", { id: artifactId, title }).catch((failure) => toast.error(errorMessage(failure)));
  }

  const thread = { title: artifact.title, href: artifactHref(artifactId) };

  async function copy() {
    try {
      if (version.type === "image") {
        if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") throw new Error("Copying images isn't supported here.");
        const blob = await (await fetch(contentUrl(artifactId, version.id))).blob();
        await navigator.clipboard.write([new ClipboardItem({ "image/png": await toPng(blob) })]);
        toast.success("Image copied");
        return;
      }
      const { text: copied } = await rpc.call("text", { id: artifactId, versionId: version.id });
      if (copied === null) throw new Error("This artifact isn't text.");
      await navigator.clipboard.writeText(copied);
      toast.success("Copied");
    } catch (failure) {
      toast.error(errorMessage(failure));
    }
  }

  async function saveAsPage() {
    setBusy(true);
    try {
      const { href } = await rpc.call("saveAsPage", { id: artifactId });
      toast.success("Saved as a page", { action: { label: "Open", onClick: () => openAppPath(href) } });
    } catch (failure) {
      toast.error(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function move(projectId: string | null) {
    try {
      await rpc.call("move", { id: artifactId, projectId });
      toast.success(`Moved to ${projectName(projects, projectId)}`);
    } catch (failure) {
      toast.error(errorMessage(failure));
    }
  }

  async function remove() {
    deleting.current = true;
    try {
      await rpc.call("delete", { id: artifactId });
      toast.success("Artifact deleted");
      onBack(true);
    } catch (failure) {
      deleting.current = false;
      toast.error(errorMessage(failure));
    }
  }

  const facts = `${TYPE_LABELS[version.type]} · ${formatBytes(version.size)}${versions.length > 1 ? ` · v${version.number}` : ""}`;

  const trailing = confirmDelete ? (
    <ItemDeleteConfirm label={`Delete this artifact${versions.length > 1 ? ` and its ${versions.length} versions` : ""}?`} onDelete={() => void remove()} onCancel={() => setConfirmDelete(false)} />
  ) : (
    <>
      {canToggle ? (
        <button
          type="button"
          aria-label="Show source"
          title={view === "source" ? "Show preview" : "Show source"}
          aria-pressed={view === "source"}
          className={ICON_BUTTON}
          onClick={() => setView(view === "source" ? "preview" : "source")}
        >
          <Icon name="Code" className="size-4" />
        </button>
      ) : null}
      {text || version.type === "image" ? (
        <button type="button" aria-label="Copy" title={version.type === "image" ? "Copy image" : "Copy text"} className={ICON_BUTTON} onClick={() => void copy()}>
          <Icon name="Copy" className="size-4" />
        </button>
      ) : null}
      <a aria-label="Download" title="Download" className={ICON_BUTTON} href={contentUrl(artifactId, version.id, { download: true })} download={version.name}>
        <Icon name="Download" className="size-4" />
      </a>
      <ItemMenu reference={thread} projects={projects} projectId={artifact.projectId} onMove={(id) => void move(id)} onDelete={() => setConfirmDelete(true)} busy={busy}>

          {studioChat === false ? (
            <DropdownMenuItem className="md:hidden" onSelect={() => openNewItemThread(navigate, thread)}>
              <Icon name="MessageSquarePlus" className="size-4" /> New thread
            </DropdownMenuItem>
          ) : null}
          {artifact.sourceThreadId ? (
            <DropdownMenuItem onSelect={() => navigate.toThread(artifact.sourceThreadId!)}>
              <Icon name="MessageSquare" className="size-4" /> Open source thread
            </DropdownMenuItem>
          ) : null}
          {text && version.type !== "html" ? (
            <DropdownMenuItem disabled={busy} onSelect={() => void saveAsPage()}>
              <Icon name="FileText" className="size-4" /> Save as page
            </DropdownMenuItem>
          ) : null}
          {versions.length > 1 ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Icon name="Clock" className="size-4" /> Versions
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-80 w-60 overflow-y-auto">
                {versions.map((each) => (
                  <DropdownMenuItem key={each.id} onSelect={() => setVersionId(each.id === latest.id ? null : each.id)}>
                    {each.id === version.id ? <Icon name="Check" className="size-4" /> : <span className="size-4" />}
                    <span className="flex-1">Version {each.number}</span>
                    <span className="text-xs text-muted-foreground">
                      {each.id === latest.id ? "Latest" : relativeTime(each.createdAt)}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}
      </ItemMenu>
    </>
  );

  return (
    <div className="studio-root flex h-full min-h-0 flex-col bg-background text-foreground">
      <ItemHeader
        backLabel={backLabel}
        onBack={() => onBack()}
        item={thread}
        leading={
          <>
            <BarTitle title={artifact.title} label="Artifact title" onRename={rename} />
            <span className="ml-1 shrink-0 truncate text-xs text-muted-foreground max-md:hidden" title={version.name}>
              {facts}
            </span>
          </>
        }
        thread={confirmDelete ? undefined : thread}
        trailing={trailing}
      />
      {older ? (
        <div className="flex shrink-0 items-center gap-3 border-b border-border/70 bg-muted/40 px-4 py-2 text-sm">
          <Icon name="Clock" className="size-4 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">
            Version {version.number} of {versions.length}, saved {shortDateTime(version.createdAt)}
          </span>
          <button type="button" className={GHOST_BUTTON} onClick={() => setVersionId(null)}>
            Back to latest
          </button>
        </div>
      ) : null}
      <div ref={body} className="min-h-0 flex-1">
        <ArtifactBody
          key={`${version.id}:${view}`}
          artifactId={artifactId}
          version={version}
          view={canToggle ? view : "preview"}
          onArea={confirmDelete ? undefined : pickArea}
        />
      </div>
      {picked && !confirmDelete ? (
        <QuoteCard
          key={`${picked.rect.left}:${picked.rect.top}:${picked.text?.length ?? 0}`}
          picked={picked}
          writing={writing}
          onWrite={() => setWriting(true)}
          item={{ pluginId: PLUGIN_ID, id: artifactId, ...thread }}
          onClose={closeQuote}
        />
      ) : null}
    </div>
  );
}

/** Browsers only put PNG images on the clipboard. */
async function toPng(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((png) => (png ? resolve(png) : reject(new Error("Couldn't copy this image."))), "image/png"),
  );
}
