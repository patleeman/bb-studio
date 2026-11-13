// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { PromptTextMention } from "@bb/domain";
import { ThreadTimelineNavigationProvider } from "./ThreadTimelineNavigationContext";
import { ConversationMessageContent } from "./ConversationMessageContent";
import { RouteNavigationProvider } from "@/components/ui/app-route-anchor";

function renderChildCompleted(text: string) {
  const token = "@thread:thr_child";
  const start = text.indexOf(token);
  const mentions: readonly PromptTextMention[] =
    start < 0
      ? []
      : [
          {
            start,
            end: start + token.length,
            resource: {
              kind: "thread",
              threadId: "thr_child",
              projectId: "proj_demo",
              label: "Rebuild comments",
            },
          },
        ];
  return render(
    <MemoryRouter>
      <RouteNavigationProvider>
        <ThreadTimelineNavigationProvider
          environmentId={null}
          hostId={null}
          onOpenLocalFileLink={() => false}
          resolveMentionLink={() => null}
          threadId="thr_parent"
          workspaceRootPath="/workspace"
        >
          <ConversationMessageContent
            role="user"
            initiator="system"
            senderThreadId={null}
            senderThreadTitle={null}
            senderIsPluginSideChat={false}
            systemMessageKind="child-completed"
            systemMessageSubject={{
              kind: "thread",
              threadId: "thr_child",
              threadName: "Rebuild comments",
            }}
            attachments={null}
            mentions={mentions}
            text={text}
            timestamp={0}
            threadId="thr_parent"
            turnRequest={{ isGrouped: false, kind: "message", status: "accepted" }}
            projectId="proj_demo"
          />
        </ThreadTimelineNavigationProvider>
      </RouteNavigationProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

const WORKER_RESULT = [
  "[bb system]",
  "",
  "@thread:thr_child completed:",
  "",
  "Saved page: Bullet Journal, PARA, Zettelkasten",
  "",
  "The page compares the three methods.",
].join("\n");

describe("a finished worker's line", () => {
  it("shows the first line of the worker's result, not a cut-off \"completed:\"", () => {
    const { container } = renderChildCompleted(WORKER_RESULT);
    expect(
      screen.getByText("Saved page: Bullet Journal, PARA, Zettelkasten", {
        exact: false,
      }),
    ).not.toBeNull();
    expect(container.textContent).not.toContain("completed:");
  });

  it("keeps the message as it is when there is no result after the header", () => {
    const { container } = renderChildCompleted(
      "[bb system]\n\n@thread:thr_child completed:",
    );
    expect(container.textContent).toContain("completed:");
  });
});
