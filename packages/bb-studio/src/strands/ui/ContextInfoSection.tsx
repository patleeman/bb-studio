// BB's thread context row (the parent thread, changed files, the pull
// request) in a strands conversation's Info tab: Studio hides it above the
// composer there (prompt-stack.ts) and draws the same row here with the
// fork's experimental_ThreadContextSegments (desktop 1.0.12). On a BB
// without it, nothing here and the row stays above the composer.
import { experimental_InfoSection as InfoSection } from "@get-bb/plugin-sdk/app";
import { useLive } from "../../ui/live";
import { hostContextSegments, type ContextInfoProps } from "./prompt-stack";
import { STRANDS_POLL_MS } from "./Strip";

export function ContextInfoSection({ threadId, projectId, environment }: ContextInfoProps) {
  const list = useLive("strands.list", { threadId }, { pollMs: STRANDS_POLL_MS });
  const Segments = hostContextSegments();
  if (!Segments || !list.data?.enabled) return null;
  return (
    <InfoSection label="Context">
      <div data-testid="strands-context-info"><Segments threadId={threadId} projectId={projectId} environment={environment} /></div>
    </InfoSection>
  );
}
