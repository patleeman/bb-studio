import { useCallback, useMemo, useState, type FormEvent } from "react";
import { useBbNavigate, useSdk } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { getMutationErrorMessage } from "../ui/mutation-errors.js";

interface ProjectHost {
  id: string;
  name: string;
}

function projectNameFromPath(path: string): string {
  return (
    path
      .trim()
      .replace(/[\\/]+$/u, "")
      .split(/[\\/]/u)
      .at(-1)
      ?.trim() ?? ""
  );
}

export function useProjectCreation(onNavigate?: () => void) {
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const [open, setOpen] = useState(false);
  const [hosts, setHosts] = useState<ProjectHost[]>([]);
  const [hostId, setHostId] = useState("");
  const [path, setPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openDialog = useCallback(() => {
    setOpen(true);
    setPath("");
    setError(null);
    setLoading(true);
    void Promise.all([sdk.hosts.list(), sdk.system.config()])
      .then(([availableHosts, config]) => {
        const connected = availableHosts
          .filter((host) => host.status === "connected")
          .map((host) => ({ id: host.id, name: host.name }));
        setHosts(connected);
        setHostId(
          connected.find((host) => host.id === config.primaryHostId)?.id ??
            connected[0]?.id ??
            "",
        );
        if (connected.length === 0)
          setError("Connect a machine to create a project.");
      })
      .catch((cause: unknown) => {
        setError(
          getMutationErrorMessage({
            error: cause,
            fallbackMessage: "Could not load machines.",
          }),
        );
      })
      .finally(() => setLoading(false));
  }, [sdk]);

  const browse = useCallback(() => {
    if (!hostId || picking) return;
    setPicking(true);
    setError(null);
    void sdk.hosts
      .pickFolder({ hostId, clientHostId: hostId })
      .then((selected) => {
        if (selected.path) setPath(selected.path);
      })
      .catch(() =>
        setError("Folder picker unavailable. Enter the folder path instead."),
      )
      .finally(() => setPicking(false));
  }, [hostId, picking, sdk]);

  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (creating || !hostId) return;
      const selectedPath = path.trim();
      const name = projectNameFromPath(selectedPath);
      if (!name) {
        setError("Choose a project folder.");
        return;
      }
      setCreating(true);
      setError(null);
      void sdk.projects
        .create({
          name,
          source: { type: "local_path", hostId, path: selectedPath },
        })
        .then((project) => {
          setOpen(false);
          navigate.toProject(project.id);
          onNavigate?.();
        })
        .catch((cause: unknown) => {
          setError(
            getMutationErrorMessage({
              error: cause,
              fallbackMessage: "Could not create the project.",
            }),
          );
        })
        .finally(() => setCreating(false));
    },
    [creating, hostId, navigate, onNavigate, path, sdk],
  );

  const dialog = useMemo(
    () => (
      <Dialog open={open} onOpenChange={(next) => !creating && setOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>
              Choose the folder for the project.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submit}>
            {hosts.length > 1 ? (
              <label className="block space-y-2 text-sm">
                <span>Machine</span>
                <select
                  aria-label="Machine"
                  className="w-full rounded-md border bg-background px-3 py-2"
                  value={hostId}
                  onChange={(event) => setHostId(event.target.value)}
                  disabled={creating}
                >
                  {hosts.map((host) => (
                    <option key={host.id} value={host.id}>
                      {host.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="block space-y-2 text-sm">
              <span>Folder path</span>
              <div className="flex gap-2">
                <Input
                  aria-label="Folder path"
                  value={path}
                  onChange={(event) => setPath(event.target.value)}
                  disabled={creating || loading}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={browse}
                  disabled={!hostId || picking || creating}
                >
                  Browse
                </Button>
              </div>
            </label>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="submit" disabled={creating || loading || !hostId}>
                {creating ? "Creating…" : "Create project"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    ),
    [
      browse,
      creating,
      error,
      hostId,
      hosts,
      loading,
      open,
      path,
      picking,
      submit,
    ],
  );

  return { dialog, isCreating: creating, openDialog };
}
