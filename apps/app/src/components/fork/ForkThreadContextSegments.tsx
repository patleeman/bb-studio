import type { ExperimentalThreadContextSegmentsProps } from "@get-bb/plugin-sdk";
import { useState } from "react";
import { ThreadPromptContextBanner } from "@/components/promptbox/banner/ThreadPromptContextBanner";
import { useThread } from "@/hooks/queries/thread-queries";
import { useParentThreadSection } from "@/views/thread-detail/useParentThreadSection";
import { ForkThreadContextElsewhere } from "./ForkPromptStack";

export function ForkThreadContextSegments({ threadId, projectId, environment }: ExperimentalThreadContextSegmentsProps) {
  const { data: thread } = useThread(threadId);
  return thread === undefined ? null : <Segments thread={thread} projectId={projectId} environment={environment} />;
}

function Segments({ thread, projectId, environment }: { thread: NonNullable<ReturnType<typeof useThread>["data"]> } & Omit<ExperimentalThreadContextSegmentsProps, "threadId">) {
  const parentThread = useParentThreadSection(thread, true);
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <ForkThreadContextElsewhere.Provider value>
      <ThreadPromptContextBanner
        input={{ threadId: thread.id, projectId, environment }}
        core={{ parentThread }}
        archivedSection={null}
        environmentGoneSection={null}
        expandedSegment={expanded}
        onToggleSegment={(key) => setExpanded((current) => (current === key ? null : key))}
      />
    </ForkThreadContextElsewhere.Provider>
  );
}
