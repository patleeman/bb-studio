// Bot creation requests from bots, waiting for approval. Studio's collection
// can't show them, so the Teams page stays (above the collection) while any do.
import { useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { Button } from "@bb-studio/kit/ui";
import type { BotCreateRequestView, rpcContract } from "./contract";
import { ErrorMessage, message } from "./bot-ui";

export function BotCreateRequests({
  botCreateRequests,
  onBotCreateRequestResolved,
}: {
  botCreateRequests: BotCreateRequestView[];
  onBotCreateRequestResolved: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [resolvingRequest, setResolvingRequest] = useState<string | null>(null);
  const [approvalError, setApprovalError] = useState<{
    requestId: string;
    message: string;
  } | null>(null);
  return (
    <section
      className="overflow-hidden rounded-lg border border-border bg-card"
      aria-labelledby="bot-creation-approvals"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2
            id="bot-creation-approvals"
            className="text-sm font-semibold"
          >
            Pending bot approvals
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Review requests from bots before they get a workspace.
          </p>
        </div>
        <span className="rounded-md bg-accent px-2 py-1 text-xs font-medium">
          {botCreateRequests.length} pending
        </span>
      </div>
      {botCreateRequests.map((request) => {
        const busy = resolvingRequest === request.id;
        return (
          <article
            key={request.id}
            className="flex flex-col gap-3 border-b border-border px-4 py-4 last:border-b-0"
          >
            <div className="flex min-w-0 items-start gap-3">
              <span aria-hidden className="text-2xl leading-7">
                {request.avatar}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <h3 className="text-sm font-semibold">
                    {request.name}
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    requested by {request.requesterName}
                    {request.channelName
                      ? ` in ${request.channelName}`
                      : ""}
                  </span>
                </div>
                {request.description ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {request.description}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
              <span>Provider: {request.providerId || "default"}</span>
              <span>Model: {request.model || "default"}</span>
              <span>Reasoning: {request.reasoningLevel}</span>
              <span>Permissions: {request.permissionMode}</span>
            </div>
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                Mission
              </div>
              <p className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-5">
                {request.mission}
                {request.missionTruncated ? "…" : ""}
              </p>
            </div>
            <ErrorMessage
              error={!busy && approvalError?.requestId === request.id
                ? approvalError.message
                : null}
            />
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={resolvingRequest !== null}
                onClick={async () => {
                  setResolvingRequest(request.id);
                  setApprovalError(null);
                  try {
                    await rpc.call("resolveBotCreateRequest", {
                      id: request.id,
                      approved: false,
                    });
                    onBotCreateRequestResolved();
                  } catch (cause) {
                    setApprovalError({ requestId: request.id, message: message(cause) });
                  } finally {
                    setResolvingRequest(null);
                  }
                }}
              >
                Deny
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={resolvingRequest !== null}
                onClick={async () => {
                  setResolvingRequest(request.id);
                  setApprovalError(null);
                  try {
                    await rpc.call("resolveBotCreateRequest", {
                      id: request.id,
                      approved: true,
                    });
                    onBotCreateRequestResolved();
                  } catch (cause) {
                    setApprovalError({ requestId: request.id, message: message(cause) });
                  } finally {
                    setResolvingRequest(null);
                  }
                }}
              >
                Approve and create
              </Button>
            </div>
          </article>
        );
      })}
    </section>
  );
}
