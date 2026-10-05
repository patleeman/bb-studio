// The full Excalidraw editor: loads a drawing, autosaves (debounced,
// ordered), follows other writers live, and offers the drawing's actions in
// Studio's item header. In a thread's panel, "Attach" renders the scene to a
// PNG and attaches it to that conversation.
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Excalidraw,
  exportToBlob,
} from "@excalidraw/excalidraw";
import type {
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";
import "../assets/excalidraw/excalidraw.css";
// Re-maps Excalidraw's palette to bb's live theme tokens; must load after
// the vendored css so the overrides win at equal specificity.
import "../assets/excalidraw-theme.css";
import {
  DropdownMenuItem,
  BAR_BUTTON,
  BarTitle,
  ICON_BUTTON,
  Icon,
  ItemHeader,
  ItemDeleteConfirm,
  ItemMenu,
  openNewItemThread,
  useStudioChatPresent,
  useOpenMain,
  cn,
} from "@bb-studio/kit/app";

import { errorMessage } from "@bb-studio/kit/format";
import {
  useBbNavigate,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import {
  blobToBase64,
  parseScene,
  resolveThemeColor,
  sanitizeAppStateForStorage,
  serializeSceneWithTombstones,
  useIsDark,
} from "../lib/scene";
import { useDrawingSync } from "../lib/sync";
import { DrawingSaveQueue } from "../lib/save-queue";
import { DraftOwnership, DrawingDraftSession, drawingDraftStore, type DrawingDraft } from "../lib/drafts";
import { DRAWING_UPDATE_TYPE, PLUGIN_ID, REALTIME_CHANNEL, drawingHref } from "../src/shared";

const SPIN = "animate-spin motion-reduce:animate-none";

export function DrawingEditor({
  drawingId,
  threadId,
  backLabel,
  onBack,
}: {
  drawingId: string;
  /** Set in a thread's panel, where the drawing can be attached. */
  threadId?: string | null;
  backLabel: string;
  /** `replace` when leaving because the drawing is gone. */
  onBack: (replace?: boolean) => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const openMain = useOpenMain();
  // Studio Chat's Chat button starts threads; the menu only offers it without one.
  const studioChat = useStudioChatPresent();
  const isDark = useIsDark();
  const [name, setName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [initialData, setInitialData] = useState<ExcalidrawInitialDataState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [draftStore] = useState(drawingDraftStore);
  const [draftLoadError, setDraftLoadError] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [recoveryDrafts, setRecoveryDrafts] = useState<DrawingDraft[]>([]);
  const [selectedDraft, setSelectedDraft] = useState<string | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [canvasGeneration, setCanvasGeneration] = useState(0);
  const baseRevision = useRef(0);
  const projectId = useRef<string | null>(null);
  const recoveryBlocked = useRef(false);
  recoveryBlocked.current = recoveryDrafts.length > 0;
  const recoveryDraft = recoveryDrafts.find(draft => draft.id === selectedDraft) ?? recoveryDrafts[0];
  const draftSessionRef = useRef<DrawingDraftSession | null>(null);
  if (!draftSessionRef.current) draftSessionRef.current = new DrawingDraftSession(draftStore, drawingId, crypto.randomUUID(), error => setLocalError(error ? errorMessage(error) : null));
  const draftSession = draftSessionRef.current;
  // Other windows skip this editor's draft while it's open (see DraftOwnership).
  const [ownership] = useState(() => new DraftOwnership());
  useEffect(() => ownership.hold(draftSession.id), [ownership, draftSession]);

  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  // Until the user touches the canvas, keep the scene centred as the canvas
  // resizes (the sidebar or a side panel opening or closing).
  const touchedRef = useRef(false);
  const loadedRef = useRef(false);
  const saveQueueRef = useRef<DrawingSaveQueue | null>(null);
  if (!saveQueueRef.current) saveQueueRef.current = new DrawingSaveQueue(async (data) => {
    const result = await rpc.call("saveDrawing", { id: drawingId, data });
    baseRevision.current = Math.max(baseRevision.current, result.updatedAt);
    await draftSession.acknowledged(data, result.updatedAt);
    return result;
  });
  const saveQueue = saveQueueRef.current;
  // The scene as last saved or loaded, serialized. Excalidraw calls onChange
  // for pointer moves, selection and scrolling too; comparing against this
  // saves only real changes, so the editor doesn't keep rewriting the scene
  // (and hearing its own write back as a remote update).
  const savedSceneRef = useRef<string | null>(null);
  // Set while a remote scene is being applied, so the onChange it causes is
  // recorded as saved rather than written back.
  const applyingRemoteRef = useRef(false);
  // Server revision the editor loaded (the sync poll's starting point).
  const serverRevSetterRef = useRef<(rev: number) => void>(() => {});
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const realtimeState = useRealtimeConnectionState();

  // Load the drawing scene once (component is keyed by drawingId).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const drafts = draftStore.list(drawingId).then((saved) => ownership.recoverable(saved)).then((saved) => {
      if (!cancelled) setRecoveryDrafts(saved);
      return saved;
    }).catch((error) => { if (!cancelled) setDraftLoadError(errorMessage(error)); return []; });
    void rpc
      .call("getDrawing", { id: drawingId })
      .then(async ({ drawing }) => {
        const savedDrafts = await drafts;
        if (cancelled) return;
        if (!drawing) {
          if (savedDrafts.length) { setName("Deleted drawing"); setLoading(false); return; }
          toast.error("Drawing not found");
          onBack(true);
          return;
        }
        baseRevision.current = drawing.updatedAt;
        projectId.current = drawing.projectId;
        setName(drawing.name);
        const scene = parseScene(drawing.data);
        if (scene) {
          // Scenes stored before the appState fix carry the full runtime
          // AppState (JSON'd Maps like `collaborators: {}`), which crashes
          // Excalidraw on load ("collaborators.forEach is not a function").
          // Strip it to the export-safe keys Excalidraw itself persists.
          scene.appState = sanitizeAppStateForStorage(scene.appState);
          // Brand-new drawings (empty scene, stock white canvas) start on
          // the active bb theme's canvas color. Drawings with content keep
          // their saved background so exports stay scene-faithful.
          if (
            scene.elements.length === 0 &&
            (scene.appState.viewBackgroundColor === undefined ||
              scene.appState.viewBackgroundColor === "#ffffff")
          ) {
            scene.appState = {
              ...scene.appState,
              viewBackgroundColor: resolveThemeColor("--canvas", "#ffffff"),
            };
          }
        }
        setInitialData(
          scene
            ? ({ ...scene, scrollToContent: true } as unknown as ExcalidrawInitialDataState)
            : null,
        );
        loadedRef.current = true;
        serverRevSetterRef.current(drawing.updatedAt);
        setLoading(false);
      })
      .catch(async (error) => {
        await drafts;
        if (cancelled) return;
        toast.error(error instanceof Error ? error.message : "Failed to load");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawingId]);

  // Live sync with other writers (agent edits via excalidraw_update_drawing,
  // the CLI, or another open editor): apply remote scenes into this editor
  // and notify when one lands. Local in-progress edits win via
  // reconcileElements inside the hook.
  const sync = useDrawingSync(
    drawingId,
    rpc as never,
    () => {
      const api = apiRef.current;
      return api && !recoveryBlocked.current
        ? {
            getSceneElementsIncludingDeleted: () =>
              api.getSceneElementsIncludingDeleted(),
            getAppState: () => api.getAppState(),
            getFiles: () => api.getFiles(),
            addFiles: (files: unknown[]) => api.addFiles(files as never),
            updateScene: (opts: { elements: unknown }) =>
              api.updateScene({ elements: opts.elements as never }),
          }
        : null;
    },
    (updatedAt) => {
      baseRevision.current = Math.max(baseRevision.current, updatedAt);
      // The server already has the scene we just applied, so the change it
      // causes isn't saved back (that would ping-pong between writers).
      const api = apiRef.current;
      if (api) {
        savedSceneRef.current = serializeSceneWithTombstones(
          [...api.getSceneElementsIncludingDeleted()],
          api.getAppState(),
          api.getFiles(),
        );
      }
      setSyncedAt(updatedAt);
    },
    (applying) => {
      applyingRemoteRef.current = applying;
    },
  );
  serverRevSetterRef.current = sync.setServerRev;

  // Briefly show "Synced" after a remote update lands.
  useEffect(() => {
    if (syncedAt === null) return;
    const t = setTimeout(() => setSyncedAt(null), 3000);
    return () => clearTimeout(t);
  }, [syncedAt]);

  useEffect(() => {
    const element = canvasRef.current;
    if (!element || loading) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (touchedRef.current) return;
      cancelAnimationFrame(frame);
      // After Excalidraw has taken the new size.
      frame = requestAnimationFrame(() => {
        const api = apiRef.current;
        if (api && api.getSceneElements().length > 0) api.scrollToContent();
      });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [loading]);

  // Leaving the editor flushes the newest scene; bounded retries continue after
  // unmount. Warn before closing the browser while a scene remains unacknowledged.
  useEffect(() => {
    const unsubscribe = saveQueue.subscribe(({ pending, error }) => {
      setSaving(pending);
      setSaveError(error ? errorMessage(error) : null);
    });
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!saveQueue.hasPending) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      unsubscribe();
      window.removeEventListener("beforeunload", beforeUnload);
      void saveQueue.flush();
    };
  }, [saveQueue]);

  const handleChange = useCallback(
    (elements: readonly unknown[], appState: unknown, files: unknown) => {
      if (!loadedRef.current) return;
      try {
        // Serialize WITH tombstones (deleted elements) so deletions propagate
        // through the server-side merge instead of silently resurrecting.
        const api = apiRef.current;
        const allElements = api
          ? [...api.getSceneElementsIncludingDeleted()]
          : [...elements];
        const serialized = serializeSceneWithTombstones(
          allElements,
          appState,
          files,
        );
        // The first change after mount is Excalidraw normalizing the loaded
        // scene, and a remote scene being applied is already on the server;
        // record either as the saved scene without writing it back.
        if (savedSceneRef.current === null || applyingRemoteRef.current || recoveryBlocked.current) {
          savedSceneRef.current = serialized;
          return;
        }
        if (serialized === savedSceneRef.current) return;
        savedSceneRef.current = serialized;
        draftSession.stage(serialized, baseRevision.current);
        saveQueue.enqueue(serialized);
      } catch (error) {
        console.error("serialize failed", error);
      }
    },
    [saveQueue, draftSession],
  );

  async function checkDrafts() {
    try { setRecoveryDrafts(await ownership.recoverable((await draftStore.list(drawingId)).filter(draft => draft.id !== draftSession.id))); setDraftLoadError(null); }
    catch (error) { setDraftLoadError(errorMessage(error)); }
  }

  async function recoverDraft(action: "recover" | "copy" | "discard") {
    const draft = recoveryDraft;
    if (!draft || recoveryBusy) return;
    setRecoveryBusy(true);
    setRecoveryError(null);
    try {
      // An open window still owns its draft: it can't be recovered or discarded here.
      await ownership.whileOrphaned(draft.id, async () => {
        if (action !== "discard") {
          if (!parseScene(draft.data)) throw new Error("This draft could not be read. Download it before discarding it.");
          if (action === "copy") {
            const { drawing } = await rpc.call("recoverDrawingCopy", {
              sourceDrawingId: drawingId, draftId: draft.id, draftToken: draft.token,
              data: draft.data, name: `${name || "Drawing"} (recovered)`.slice(0, 200), projectId: projectId.current,
            });
            await draftStore.remove(draft.id, draft.token);
            await checkDrafts();
            openMain({ kind: "path", path: drawingHref(drawing.id), title: drawing.name });
            return;
          }
          await rpc.call("saveDrawing", { id: drawingId, data: draft.data, expectedUpdatedAt: draft.baseRevision });
          const { drawing } = await rpc.call("getDrawing", { id: drawingId });
          if (!drawing) throw new Error("The drawing was removed. Your local draft is still available.");
          const scene = parseScene(drawing.data);
          baseRevision.current = drawing.updatedAt;
          loadedRef.current = true;
          projectId.current = drawing.projectId;
          setName(drawing.name);
          serverRevSetterRef.current(drawing.updatedAt);
          savedSceneRef.current = null;
          apiRef.current = null;
          setInitialData(scene ? { ...scene, appState: sanitizeAppStateForStorage(scene.appState), scrollToContent: true } as unknown as ExcalidrawInitialDataState : null);
          setCanvasGeneration(value => value + 1);
        }
        await draftStore.remove(draft.id, draft.token);
        await checkDrafts();
      });
    } catch (error) { setRecoveryError(errorMessage(error)); }
    finally { setRecoveryBusy(false); }
  }

  function downloadDraft() {
    if (!recoveryDraft) return;
    const url = URL.createObjectURL(new Blob([recoveryDraft.data], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url; link.download = "recovered-drawing.excalidraw"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function renderPng(): Promise<Blob> {
    const api = apiRef.current;
    if (!api) throw new Error("Editor not ready");
    const elements = api
      .getSceneElements()
      .filter((el) => !el.isDeleted);
    const appState = api.getAppState();
    const files = api.getFiles();
    return exportToBlob({
      elements,
      appState,
      files,
      mimeType: "image/png",
      exportBackground: true,
    });
  }

  async function downloadPng() {
    try {
      const blob = await renderPng();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(name.trim() || "drawing").replace(/[\\/:*?"<>|]+/g, "-")}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function copyImage() {
    try {
      const blob = await renderPng();
      if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
        throw new Error("Clipboard image writing is not supported here");
      }
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
      toast.success("Image copied to clipboard");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  /** Deleting here: deleteDrawing() says so and goes back, not the realtime path. */
  const deleting = useRef(false);
  // Deleted elsewhere (Studio, the CLI, another window) while open.
  useRealtime(REALTIME_CHANNEL, (payload) => {
    const event = payload as { type?: string; drawingId?: string } | null;
    if (event?.type !== DRAWING_UPDATE_TYPE || event.drawingId !== drawingId || deleting.current) return;
    void rpc.call("getDrawingUpdatedAt", { id: drawingId }).then(({ updatedAt }) => {
      if (updatedAt !== 0 || deleting.current) return;
      saveQueue.cancel();
      toast.info("This drawing was deleted.");
      onBack(true);
    }).catch(() => { /* The next change event checks again. */ });
  });

  function rename(next: string) {
    const trimmed = next.trim();
    if (trimmed === name.trim()) return;
    setName(trimmed);
    void rpc.call("renameDrawing", { id: drawingId, name: trimmed }).catch((error) => toast.error(errorMessage(error)));
  }

  const thread = { title: name.trim() || "Untitled drawing", href: drawingHref(drawingId) };

  async function attachAsImage() {
    if (!threadId) return;
    setAttaching(true);
    try {
      const blob = await renderPng();
      const pngBase64 = await blobToBase64(blob);
      await rpc.call("attachDrawingImage", {
        threadId,
        drawingId,
        pngBase64,
      });
      toast.success("Drawing attached");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setAttaching(false);
    }
  }

  async function deleteDrawing() {
    deleting.current = true;
    try {
      await rpc.call("deleteDrawing", { id: drawingId });
      saveQueue.cancel();
      await draftSession.discard().catch(error => toast.error(`Drawing deleted, but its local recovery draft could not be removed: ${errorMessage(error)}`));
      toast.success("Drawing deleted");
      onBack(true);
    } catch (error) {
      deleting.current = false;
      toast.error(errorMessage(error));
    }
  }

  const status = (
    <span
      role="status"
      aria-live="polite"
      title={
        recoveryDraft ? "An unsaved local draft needs a recovery decision."
          : !loadedRef.current ? "The drawing has not loaded."
          : saveError ? "Changes are not saved. Retry saving before closing this drawing."
          : saving ? "Saving your changes…"
          : realtimeState === "connected"
          ? "Live — agent edits appear here automatically"
          : "Reconnecting to live sync…"
      }
      className="flex h-7 shrink-0 items-center gap-1.5 px-1.5 text-xs text-muted-foreground max-sm:hidden"
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 rounded-full",
          saveError ? "bg-destructive" : recoveryDraft || !loadedRef.current || saving || realtimeState !== "connected"
            ? "animate-pulse bg-warning motion-reduce:animate-none" : "bg-success",
        )}
      />
      {recoveryDraft ? "Local draft" : !loadedRef.current ? "Not loaded" : saveError ? "Not saved" : saving ? "Saving…" : syncedAt ? "Synced" : "Saved"}
    </span>
  );

  const trailing = confirmDelete ? (
    <ItemDeleteConfirm label="Delete this drawing?" onDelete={() => void deleteDrawing()} onCancel={() => setConfirmDelete(false)} />
  ) : (
    <>
      {threadId ? (
        <button type="button" aria-label="Attach to thread" title="Attach to thread as an image" className={ICON_BUTTON} disabled={attaching} onClick={() => void attachAsImage()}>
          <Icon name={attaching ? "Loading" : "Paperclip"} className={cn("size-4", attaching && SPIN)} />
        </button>
      ) : null}
      <button type="button" aria-label="Copy image" title="Copy image" className={ICON_BUTTON} onClick={() => void copyImage()}>
        <Icon name="Copy" className="size-4" />
      </button>
      <ItemMenu reference={thread} item={{ pluginId: PLUGIN_ID, id: drawingId }} projectId={projectId.current} onMoved={() => void rpc.call("getDrawing", { id: drawingId }).then(({ drawing }) => { if (drawing) projectId.current = drawing.projectId; })} onDelete={() => setConfirmDelete(true)} className="w-52">

          {threadId || studioChat !== false ? null : (
            <DropdownMenuItem className="md:hidden" onSelect={() => openNewItemThread(navigate, thread)}>
              <Icon name="MessageSquarePlus" className="size-4" /> New thread
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => void downloadPng()}>
            <Icon name="Download" className="size-4" /> Download PNG
          </DropdownMenuItem>
      </ItemMenu>
    </>
  );

  return (
    <div className="studio-root flex h-full min-h-0 flex-col bg-background text-foreground">
      <ItemHeader
        thread={threadId || confirmDelete ? undefined : thread}
        item={thread}
        backLabel={backLabel}
        onBack={() => onBack()}
        leading={
          <>
            <BarTitle
              key={`${drawingId}:${name}`}
              title={name}
              label="Drawing name"
              placeholder="Untitled drawing"
              disabled={loading || recoveryDrafts.length > 0}
              onRename={rename}
            />
            {loading ? null : status}
          </>
        }
        trailing={trailing}
      />
      {localError || draftLoadError ? <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-sm text-destructive">
        <span className="min-w-0 flex-1">Local recovery storage failed: {localError || draftLoadError}. Keep this drawing open until the server says Saved.</span>
        <button type="button" className={BAR_BUTTON} onClick={() => void draftSession.retry().then(checkDrafts)}>Retry local storage</button>
      </div> : null}
      {recoveryDraft ? <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-sm" role="region" aria-label="Unsaved drawing recovery">
        <span className="min-w-0 flex-1">{baseRevision.current === recoveryDraft.baseRevision ? "An unsaved local draft is available." : "The server drawing changed or is unavailable. Save the local draft as a copy to keep both versions."}</span>
        {recoveryDrafts.length > 1 ? <select aria-label="Local draft to recover" value={recoveryDraft.id} onChange={event => setSelectedDraft(event.target.value)} disabled={recoveryBusy}>
          {recoveryDrafts.map(draft => <option key={draft.id} value={draft.id}>{new Date(draft.updatedAt).toLocaleString()}</option>)}
        </select> : null}
        <button type="button" className={BAR_BUTTON} disabled={recoveryBusy} onClick={() => void recoverDraft("recover")}>Recover draft</button>
        <button type="button" className={BAR_BUTTON} disabled={recoveryBusy} onClick={() => void recoverDraft("copy")}>Save as copy</button>
        <button type="button" className={BAR_BUTTON} onClick={downloadDraft}>Download draft</button>
        <button type="button" className={BAR_BUTTON} disabled={recoveryBusy} onClick={() => { if (confirm("Discard this unsaved local draft?")) void recoverDraft("discard"); }}>Discard draft</button>
        {recoveryError ? <p role="alert" className="w-full text-destructive">{recoveryError} Your local draft is retained; retry or save a copy.</p> : null}
      </div> : null}
      {saveError ? (
        <div role="alert" className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-sm text-destructive">
          <span className="min-w-0 flex-1">Changes are not saved: {saveError}</span>
          <button type="button" className={BAR_BUTTON} onClick={() => saveQueue.retry()}>Retry save</button>
        </div>
      ) : null}
      <div
        ref={canvasRef}
        className="relative min-h-0 flex-1 overflow-hidden bg-background"
        onPointerDownCapture={() => (touchedRef.current = true)}
        onWheelCapture={() => (touchedRef.current = true)}
        onKeyDownCapture={() => (touchedRef.current = true)}
      >
        {loading ? (
          <div role="status" className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loading" className={cn("size-4", SPIN)} /> Loading drawing…
          </div>
        ) : (
          <Excalidraw
            key={`${drawingId}:${canvasGeneration}`}
            viewModeEnabled={recoveryDrafts.length > 0 || !loadedRef.current}
            initialData={initialData}
            onChange={handleChange}
            excalidrawAPI={(api) => {
              apiRef.current = api;
            }}
            theme={isDark ? "dark" : "light"}
            UIOptions={{
              canvasActions: {
                toggleTheme: true,
                export: false,
                saveToActiveFile: false,
                loadScene: false,
              },
            }}
          />
        )}
      </div>
    </div>
  );
}
