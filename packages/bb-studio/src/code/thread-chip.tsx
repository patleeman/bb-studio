import type { CodeContract } from "./contract";
// A small VS Code button (the code icon) in a thread's header, shown once the
// thread has a workspace or has edited files: one click opens the thread's
// VS Code tab. A dot pulses while the agent is editing.
import { useCallback, useEffect, useState } from "react";
import { useBbNavigate, useRealtime, useRpc, type PluginThreadHeaderActionProps } from "@get-bb/plugin-sdk/app";
import { Icon } from "@bb-studio/kit/app";
import { CHANNEL, CODE_TAB } from "./shared";

type Chip = { workspaceId: string | null; title: string; working: boolean };

export function ThreadCodeChip({ threadId }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<CodeContract>();
  const navigate = useBbNavigate();
  const [chip, setChip] = useState<Chip | null>(null);
  const load = useCallback(() => {
    rpc.call("code.threadChip", { threadId }).then(({ chip }) => setChip(chip), () => undefined);
  }, [rpc, threadId]);
  useEffect(load, [load]);
  // This thread's editing started or stopped, or a workspace came or went.
  useRealtime(CHANNEL, (event) => {
    const message = event as { type?: string; threadId?: string; id?: string } | null;
    if (message?.type === "key") return;
    if (message?.type !== "thread" || message.threadId === threadId) load();
  });
  const open = useCallback(() => { navigate.openThreadPanel({ actionId: CODE_TAB, title: "VS Code" }); }, [navigate]);
  if (!chip) return null;
  const label = chip.working ? `Open ${chip.title} in VS Code: the agent is editing files` : `Open ${chip.title} in VS Code`;
  return (
    <button type="button" className={CHIP} title={label} aria-label={label} onClick={open}>
      <Icon name="Code" className="size-4" />
      {chip.working && (
        <span aria-hidden className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary ring-2 ring-background motion-safe:animate-pulse" />
      )}
    </button>
  );
}

/** An icon button with a visible edge, so it reads as a button in the header. */
const CHIP =
  "relative inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground shadow-sm outline-none hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4";
