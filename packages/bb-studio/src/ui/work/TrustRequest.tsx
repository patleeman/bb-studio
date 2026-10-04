// A bot set to "Ask first" wants to change something outside its own work.
// Shown in the thread and in the Inbox; nothing happens until you approve.
import type { PluginPendingInteractionProps } from "@get-bb/plugin-sdk/app";
import { GHOST_BUTTON, PRIMARY_BUTTON } from "@bb-studio/kit/app";
import { useState } from "react";
import { Face } from "./Face";

interface TrustPayload {
  toolName?: string;
  arguments?: unknown;
  botId?: string;
  botName?: string;
  botAvatar?: string | null;
  summary?: string;
}

/** "pages_edit" → "edit a page"; unknown tools fall back to their name. */
function describeTool(name: string | undefined): string {
  if (!name) return "make a change";
  const [area, verb] = name.split("_", 2);
  const noun: Record<string, string> = { pages: "page", tasks: "task", tables: "table", artifacts: "artifact", feed: "feed post", talk: "recording", bots: "bot", excalidraw: "drawing" };
  return verb && noun[area!] ? `${verb.replace(/_/g, " ")} a ${noun[area!]}` : name.replace(/_/g, " ");
}

export function TrustRequest({ interaction, submit }: PluginPendingInteractionProps) {
  const payload = (interaction.payload ?? {}) as TrustPayload;
  const [busy, setBusy] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const name = payload.botName ?? "A bot";
  const respond = async (approved: boolean) => {
    setBusy(true);
    try { await submit({ approved }); } finally { setBusy(false); }
  };
  return (
    <div className="flex gap-3 rounded-lg border border-border bg-background p-3 text-sm">
      <Face name={name} avatar={payload.botAvatar ?? null} size="md" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{name} wants to {describeTool(payload.toolName)}</p>
        <p className="mt-0.5 text-muted-foreground">{payload.summary ?? "It's set to ask first before changing anything outside its own work."}</p>
        {payload.arguments !== undefined
          ? <button type="button" onClick={() => setShowDetails(!showDetails)} className="mt-1 text-xs text-muted-foreground underline-offset-2 hover:underline" aria-expanded={showDetails}>
              {showDetails ? "Hide details" : "Show details"}
            </button>
          : null}
        {showDetails
          ? <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted p-2 text-xs">{JSON.stringify(payload.arguments, null, 2)}</pre>
          : null}
        <div className="mt-3 flex gap-2">
          <button type="button" disabled={busy} onClick={() => void respond(true)} className={`${PRIMARY_BUTTON} h-8 px-3`}>Approve</button>
          <button type="button" disabled={busy} onClick={() => void respond(false)} className={GHOST_BUTTON}>Deny</button>
        </div>
      </div>
    </div>
  );
}
