// "New thread" inside a project: BB's own composer in a dialog. The server
// starts the thread in the project's folder (or Personal) and adds it to the
// project in the same step, so it lands in the project even without a folder.
import * as Dialog from "@radix-ui/react-dialog";
import {
  experimental_NewThreadComposer as NewThreadComposer,
  experimental_useSidebarThreads as useSidebarThreads,
  useBbNavigate,
  type NewThreadRequest,
} from "@get-bb/plugin-sdk/app";
import { GHOST_BUTTON } from "@bb-studio/kit/app";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useCall } from "./model";
import { useWork } from "./projects";
import { PORTAL_SCOPE } from "./styles";

/**
 * `start(projectId)` opens the dialog; render `dialog` once in the component.
 * Each slot (sidebar, project view, workbench tab) is its own React root, so
 * each keeps its own.
 */
export function useStartThread(): { start: (projectId: string) => void; dialog: ReactNode } {
  const [projectId, setProjectId] = useState<string | null>(null);
  const start = useCallback((id: string) => setProjectId(id), []);
  return { start, dialog: projectId ? <StartThreadDialog projectId={projectId} onClose={() => setProjectId(null)} /> : null };
}

function StartThreadDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const call = useCall();
  const work = useWork();
  const { projects: bbProjects } = useSidebarThreads();
  const navigate = useBbNavigate();
  const [error, setError] = useState<string | null>(null);
  const project = useMemo(() => [work.chief, ...work.projects].find((entry) => entry?.id === projectId) ?? null, [work, projectId]);
  const startIn = project?.bbProjectId ?? bbProjects.find((entry) => entry.isPersonal)?.id;
  const submit = async (request: NewThreadRequest) => {
    setError(null);
    try {
      const { threadId } = await call("project_thread_start", { projectId, request }) as { threadId: string };
      work.refresh();
      // The sidebar may not have the new thread yet; go by route.
      navigate.toThread(threadId);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    }
  };
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay {...PORTAL_SCOPE} className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content {...PORTAL_SCOPE} className="fixed top-1/2 left-1/2 z-50 w-[min(600px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-popover p-5 text-popover-foreground shadow-xl outline-none">
          <Dialog.Title className="text-base font-semibold">New thread in {project?.name ?? "this project"}</Dialog.Title>
          <Dialog.Description className="mt-1 mb-4 text-sm text-muted-foreground">It joins the project, so the lead sees it and it shows in the project's Overview.</Dialog.Description>
          <NewThreadComposer {...(startIn ? { defaultProjectId: startIn } : {})} placeholder="What should this thread do?" draftKey={`project-thread:${projectId}`} onSubmit={submit} />
          {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
          <div className="mt-4 flex justify-end"><Dialog.Close className={GHOST_BUTTON}>Cancel</Dialog.Close></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
