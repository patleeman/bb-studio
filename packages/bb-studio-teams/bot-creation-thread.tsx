import { useState } from "react";
import { experimental_NewThreadComposer as NewThreadComposer, useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./client-contract";
import { botCreationPrompt } from "./bot-creation";
import { BackButton, ErrorMessage, message } from "./bot-ui";
import { ExternalAgentBadge, useEnabledExternalAgents } from "./external-health";

/** Outside agents a new bot can run on, when the External Agents plugin has any turned on. */
function OutsideAgents() {
  const agents = useEnabledExternalAgents();
  if (!agents.length) return null;
  return (
    <div data-outside-agents className="mx-auto mb-2 flex w-full max-w-5xl flex-wrap items-center gap-2 px-4 text-xs text-muted-foreground">
      <span>Outside agents you can run a bot on:</span>
      {agents.map(agent => <ExternalAgentBadge key={agent.id} providerId={agent.id} health={agent.health} />)}
      <span>Ask for one by name. They chat and work on their own side and can't use BB tools.</span>
    </div>
  );
}

export function BotCreationThread({ spaceId }: { spaceId?: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex h-full min-h-0 flex-col" data-bot-creation-thread>
      <header className="flex items-center gap-2 px-4 py-3">
        <BackButton
          label="All bots"
          onClick={() => navigate.toPluginPanel("bots")}
        />
        <h1 className="text-sm font-medium">Create a bot</h1>
      </header>
      <ErrorMessage error={error} />
      <OutsideAgents />
      {(
        <NewThreadComposer
          className="mx-auto min-h-0 w-full max-w-5xl flex-1 px-4 pb-4"
          draftKey={`bot-creation:${spaceId ? `space:${spaceId}` : "standalone"}`}
          initialPrompt={botCreationPrompt(undefined, spaceId)}
          focusRequest={1}
          onSubmit={async (request) => {
            setError(null);
            try {
              const { threadId } = await rpc.call("createBotSetupThread", request);
              navigate.toThread(threadId);
            } catch (cause) {
              setError(message(cause));
              throw cause; // Keep the host composer draft for retry.
            }
          }}
        />
      )}
    </div>
  );
}
