import type { ExperimentalThreadContextSegmentsProps } from "@get-bb/plugin-sdk";
import { useState } from "react";
import { ThreadPromptContextBanner } from "@/components/promptbox/banner/ThreadPromptContextBanner";
import { ForkThreadContextElsewhere } from "./ForkPromptStack";

export function ForkThreadContextSegments({ threadId, projectId, environment }: ExperimentalThreadContextSegmentsProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <ForkThreadContextElsewhere.Provider value>
      <ThreadPromptContextBanner
        input={{ threadId, projectId, environment }}
        archivedSection={null}
        environmentGoneSection={null}
        expandedSegment={expanded}
        onToggleSegment={(key) => setExpanded((current) => (current === key ? null : key))}
      />
    </ForkThreadContextElsewhere.Provider>
  );
}
