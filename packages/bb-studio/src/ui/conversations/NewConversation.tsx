// A Bot's + New: BB's own new-thread composer (experimental_NewThreadComposer)
// on a Studio page, seeded with the Bot's default model and its Main's
// project. Patrick can pick any other model before sending; the thread is
// started by bot_conversation_start as that Bot's conversation, and keeps
// whatever model it was started on. The composer mounts at once, from the
// Bot id in the address: the Bot's name and default model arrive after
// (bot_get) and re-seed it. The page is a start page: the composer sits in
// the middle, and under a scene theme the main view draws no page card
// (START_PAGE_CSS), so the composer's own glass card is alone on the scene.
import { experimental_NewThreadComposer as NewThreadComposer, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { useState } from "react";
import { StudioBar } from "../../kit/app/index";
import { errorMessage } from "../../kit/format";
import { toReasoningLevel } from "../../kit/reasoning";
import { useGlass } from "../../theme/glass";
import { BACKING_SELECTORS } from "../../theme/tokens";
import { useCall, useLive } from "../live";

export const START_PAGE_ATTRIBUTE = "data-studio-start-page";
export const START_PAGE_CSS = `${BACKING_SELECTORS.pages}:has([${START_PAGE_ATTRIBUTE}]) { background: none; -webkit-backdrop-filter: none; backdrop-filter: none; box-shadow: none; }`;

export function NewConversationPage({ botId, projectId }: { botId: string; projectId: string | null }) {
  const call = useCall();
  const navigate = useBbNavigate();
  const view = useLive("bot_get", { botId }, { pollMs: 0 });
  const [error, setError] = useState<string | null>(null);
  const bot = view.data?.bot ?? null;
  const missing = !!view.data && !bot;
  const preset = bot?.defaultModel ?? null;
  const glass = useGlass();
  return (
    <div data-testid="new-conversation-page" {...{ [START_PAGE_ATTRIBUTE]: "" }} className="flex h-full min-h-0 flex-col text-foreground">
      <style>{START_PAGE_CSS}</style>
      <StudioBar slotOnly={glass}>{glass ? <span hidden /> : <span className="truncate px-1.5 text-sm text-muted-foreground">{bot ? `New conversation · ${bot.name}` : "New conversation"}</span>}</StudioBar>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center gap-2 px-4 pt-12 pb-[16vh]">
          {view.error && !view.data ? <p role="alert" className="text-sm text-destructive">{view.error}</p> : null}
          {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
          {missing ? <p className="text-sm text-muted-foreground">No Bot</p> : (
            <NewThreadComposer
              key={botId}
              className="studio-conversation-composer"
              layout="document"
              draftKey={`studio-bot-new:${botId}`}
              focusRequest={1}
              {...(projectId ? { defaultProjectId: projectId } : {})}
              {...(preset ? { defaultProviderId: preset.providerId, defaultModel: preset.model, ...(preset.reasoningLevel ? { defaultReasoningLevel: preset.reasoningLevel } : {}) } : {})}
              onSubmit={async (request) => {
                setError(null);
                try {
                  const { threadId } = await call("bot_conversation_start", { botId, request: { ...request, reasoningLevel: toReasoningLevel(request.reasoningLevel) } });
                  navigate.toThread(threadId);
                } catch (cause) {
                  setError(errorMessage(cause));
                  throw cause;
                }
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
