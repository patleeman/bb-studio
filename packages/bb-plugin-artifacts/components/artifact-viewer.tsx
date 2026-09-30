// One artifact: its contents by type under Studio's item header, with its
// versions, the thread it came from, and Save as page for text.
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  DANGER_BUTTON,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  FLOATING,
  FLOATING_BUTTON,
  GHOST_BUTTON,
  ICON_BUTTON,
  Icon,
  ItemHeader,
  cn,
  openAppPath,
  projectName,
  useProjects,
} from "@bb-studio/kit/app";
import { mentionPrompt } from "@bb-studio/kit/contract";
import { errorMessage, relativeTime, shortDateTime } from "@bb-studio/kit/format";
import { useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { z } from "zod";
import type { rpcContract } from "../server";
import { ARTIFACT_UPDATE_TYPE, REALTIME_CHANNEL, TYPE_LABELS, artifactHref, contentUrl, formatBytes, isTextType } from "../src/shared";
import { ArtifactBody, type BodyView } from "./artifact-body";

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
  const projects = useProjects();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** An older version being looked at; null follows the newest. */
  const [versionId, setVersionId] = useState<string | null>(null);
  const [view, setView] = useState<BodyView>("preview");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  const load = useCallback(
    () =>
      rpc.call("get", { id: artifactId }).then(
        (result) => {
          if (!result.artifact) {
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
        <ItemHeader className="relative shrink-0 items-center border-b border-border/70" backLabel={backLabel} onBack={() => onBack()} />
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

  function newThread() {
    navigate.toCompose({ initialPrompt: mentionPrompt([{ title: artifact.title, href: artifactHref(artifactId) }]), focusPrompt: true });
  }

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
    try {
      await rpc.call("delete", { id: artifactId });
      toast.success("Artifact deleted");
      onBack(true);
    } catch (failure) {
      toast.error(errorMessage(failure));
    }
  }

  const facts = `${TYPE_LABELS[version.type]} · ${formatBytes(version.size)}${versions.length > 1 ? ` · v${version.number}` : ""}`;

  const trailing = confirmDelete ? (
    <div className={cn(FLOATING, "flex items-center gap-1.5 rounded-md py-1 pr-1 pl-3 text-sm")}>
      <span className="max-sm:hidden">
        Delete this artifact{versions.length > 1 ? ` and its ${versions.length} versions` : ""}?
      </span>
      <button type="button" className={DANGER_BUTTON} onClick={() => void remove()}>
        Delete
      </button>
      <button type="button" className={GHOST_BUTTON} onClick={() => setConfirmDelete(false)}>
        Cancel
      </button>
    </div>
  ) : (
    <>
      {canToggle ? (
        <div role="group" aria-label="View" className={cn(FLOATING, "flex h-8 items-center rounded-md p-0.5 max-sm:hidden")}>
          {(["preview", "source"] as const).map((each) => (
            <button
              key={each}
              type="button"
              aria-pressed={view === each}
              className="h-7 rounded-[5px] px-2.5 text-xs text-muted-foreground hover:text-foreground aria-pressed:bg-state-active aria-pressed:text-foreground"
              onClick={() => setView(each)}
            >
              {each === "preview" ? "Preview" : "Source"}
            </button>
          ))}
        </div>
      ) : null}
      <button type="button" className={cn(FLOATING_BUTTON, "max-md:hidden")} onClick={newThread}>
        <Icon name="MessageSquarePlus" /> New thread
      </button>
      {text || version.type === "image" ? (
        <button type="button" aria-label="Copy" title={version.type === "image" ? "Copy image" : "Copy text"} className={ICON_BUTTON} onClick={() => void copy()}>
          <Icon name="Copy" className="size-4" />
        </button>
      ) : null}
      <a aria-label="Download" title="Download" className={ICON_BUTTON} href={contentUrl(artifactId, version.id, { download: true })} download={version.name}>
        <Icon name="Download" className="size-4" />
      </a>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="More" className={ICON_BUTTON}>
            <Icon name={busy ? "Loading" : "MoreHorizontal"} className={cn("size-4", busy && SPIN)} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem className="md:hidden" onSelect={newThread}>
            <Icon name="MessageSquarePlus" className="size-4" /> New thread
          </DropdownMenuItem>
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
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Icon name="MoveTo" className="size-4" /> Move to
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-80 w-56 overflow-y-auto">
              <DropdownMenuLabel className="text-xs text-muted-foreground">Now in {projectName(projects, artifact.projectId)}</DropdownMenuLabel>
              {[{ id: null, name: "Global" }, ...projects].map((project) => (
                <DropdownMenuItem key={project.id ?? "global"} disabled={project.id === artifact.projectId} onSelect={() => void move(project.id)}>
                  <Icon name={project.id ? "Folder" : "Globe"} className="size-4" /> {project.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
            <Icon name="Trash2" className="size-4" /> Delete…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );

  return (
    <div className="studio-root flex h-full min-h-0 flex-col bg-background text-foreground">
      <ItemHeader
        className="relative shrink-0 items-center border-b border-border/70"
        backLabel={backLabel}
        onBack={() => onBack()}
        leading={
          <>
            <input
              aria-label="Artifact title"
              key={artifact.title}
              defaultValue={artifact.title}
              maxLength={200}
              className="h-8 min-w-24 max-w-md rounded-md bg-transparent px-2 text-sm font-medium outline-none [field-sizing:content] hover:bg-state-hover focus:bg-state-hover max-md:max-w-32"
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") {
                  event.currentTarget.value = artifact.title;
                  event.currentTarget.blur();
                }
              }}
              onBlur={(event) => rename(event.currentTarget.value)}
            />
            <span className="shrink-0 truncate text-xs text-muted-foreground max-sm:hidden" title={version.name}>
              {facts}
            </span>
          </>
        }
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
      <div className="min-h-0 flex-1">
        <ArtifactBody key={`${version.id}:${view}`} artifactId={artifactId} version={version} view={canToggle ? view : "preview"} />
      </div>
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
