// Hand a task to an agent: pick the agent and where it works, add a note,
// and BB starts a thread that follows the task.
import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { toast } from "sonner";
import { GHOST_BUTTON, Icon, PRIMARY_BUTTON, cn, type Project } from "@bb-studio/kit/app";
import { errorMessage } from "@bb-studio/kit/format";
import { experimental_ProviderModelPicker as ProviderModelPicker, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { useStored } from "./board";
import { SPIN, useTasksRpc, type Task } from "./types";

type Agent = ComponentProps<typeof ProviderModelPicker>["value"];
type Workspace = "worktree" | "folder";

export function HandoffPanel({ task, projects, onClose }: { task: Task; projects: Project[]; onClose(): void }) {
  const rpc = useTasksRpc();
  const navigate = useBbNavigate();
  const [projectId, setProjectId] = useState<string | null>(task.projectId ?? projects[0]?.id ?? null);
  /** Null runs the project's default agent. */
  const [agent, setAgent] = useState<Agent | null | undefined>(undefined);
  const [workspace, setWorkspace] = useStored<Workspace>("tasks:workspace", "worktree");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id);
  }, [projectId, projects]);

  useEffect(() => {
    if (!projectId) return;
    let live = true;
    setAgent(undefined);
    rpc.call("handoffDefaults", { projectId }).then(
      (defaults) =>
        live &&
        setAgent(
          defaults.providerId && defaults.model
            ? { providerId: defaults.providerId, model: defaults.model, reasoningLevel: (defaults.reasoningLevel ?? "medium") as Agent["reasoningLevel"] }
            : null,
        ),
      () => live && setAgent(null),
    );
    return () => {
      live = false;
    };
  }, [rpc, projectId]);

  async function handOff() {
    if (!projectId) return;
    setBusy(true);
    try {
      const { threadId } = await rpc.call("handOff", {
        id: task.id,
        projectId,
        providerId: agent?.providerId ?? null,
        model: agent?.model ?? null,
        reasoningLevel: agent?.reasoningLevel ?? null,
        note: note.trim() || null,
        workspace,
      });
      toast.success("Handed to an agent", { action: { label: "Open thread", onClick: () => navigate.toThread(threadId) } });
      onClose();
    } catch (failure) {
      toast.error(`Couldn't hand off the task: ${errorMessage(failure)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4">
      <div className="flex items-center gap-2">
        <Icon name="Bot" className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">Hand off to an agent</h3>
        <button type="button" aria-label="Close" className="ml-auto flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover" onClick={onClose}>
          <Icon name="X" className="size-4" />
        </button>
      </div>
      {!projects.length ? (
        <p className="text-sm text-muted-foreground">Add a project to BB first.</p>
      ) : (
        <>
          <Row label="Project">
            <select
              aria-label="Project"
              value={projectId ?? ""}
              className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm"
              onChange={(event) => setProjectId(event.currentTarget.value || null)}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Agent">
            {agent === undefined ? (
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <Icon name="Loading" className={cn("size-4", SPIN)} /> Loading…
              </span>
            ) : agent === null ? (
              <span className="text-sm text-muted-foreground">The project's default agent</span>
            ) : (
              <ProviderModelPicker value={agent} onChange={setAgent} />
            )}
          </Row>
          <Row label="Works in">
            <div role="group" aria-label="Works in" className="flex h-8 items-center rounded-md border border-border p-0.5">
              {(
                [
                  ["worktree", "New worktree"],
                  ["folder", "Project folder"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={workspace === value}
                  className="h-7 rounded-[5px] px-2.5 text-xs text-muted-foreground hover:text-foreground aria-pressed:bg-state-active aria-pressed:text-foreground"
                  onClick={() => setWorkspace(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </Row>
          <textarea
            aria-label="Note for the agent"
            placeholder="Note (optional)"
            rows={3}
            value={note}
            maxLength={20_000}
            className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            onChange={(event) => setNote(event.currentTarget.value)}
          />
          <div className="flex justify-end gap-2">
            <button type="button" className={GHOST_BUTTON} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className={PRIMARY_BUTTON} disabled={busy || !projectId || agent === undefined} onClick={() => void handOff()}>
              <Icon name={busy ? "Loading" : "Bot"} className={cn(busy && SPIN)} /> Hand off
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 shrink-0 text-sm text-muted-foreground">{label}</span>
      <div className="flex min-w-0 flex-1 items-center">{children}</div>
    </div>
  );
}
