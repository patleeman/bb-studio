// @vitest-environment jsdom
import { expect, it, vi } from "vitest";

vi.mock("@get-bb/plugin-sdk/app", () => ({ ThreadTitle: () => null, experimental_Icon: () => null }));
vi.mock("../../ui/comments/CommentAuthor", () => ({ CommentAuthor: () => null }));

const { commentBody, textOfBody, threadViews } = await import("./PageComments");

const at = (ms: number) => new Date(ms);
const comment = (id: string, userId: string, text: string, ms: number, deleted = false) => ({
  type: "comment" as const, id, userId, createdAt: at(ms), updatedAt: at(ms), reactions: [], metadata: {},
  ...(deleted ? { deletedAt: at(ms), body: undefined } : { body: commentBody(text) }),
});
const thread = (id: string, comments: ReturnType<typeof comment>[], extra: Record<string, unknown> = {}) => ({
  type: "thread" as const, id, createdAt: at(1), updatedAt: at(1), comments, resolved: false, metadata: {}, ...extra,
});

it("writes a comment body as paragraphs and reads it back as text", () => {
  const body = commentBody("First line\nSecond line") as { type: string; content: { text: string }[] }[];
  expect(body.map((block) => block.type)).toEqual(["paragraph", "paragraph"]);
  expect(textOfBody(body)).toBe("First line\nSecond line");
  expect(textOfBody([{ content: [{ type: "mention", props: { label: "Plan" } }, { type: "text", text: " now" }] }])).toBe("@Plan now");
});

it("lists threads in page order with their quotes, leaves out deleted ones, and carries who resolved them", () => {
  const views = threadViews(
    [
      thread("late", [comment("c1", "user", "Second", 10)]),
      thread("early", [comment("c2", "agent:thr_a", "First", 20), comment("c3", "user", "gone", 21, true)], { resolved: true, resolvedBy: "user", resolvedUpdatedAt: at(30) }),
      thread("deleted", [comment("c4", "user", "x", 5)]),
      thread("empty", [comment("c5", "user", "x", 5, true)]),
    ] as never,
    (id) => id === "deleted",
    (id) => ({ late: { quote: "crash rate", at: 50 }, early: { quote: "40 teams", at: 12 } } as Record<string, { quote: string; at: number }>)[id] ?? { quote: "", at: null },
  );
  expect(views.map((view) => view.id)).toEqual(["early", "late"]);
  expect(views[0]).toMatchObject({ quote: "40 teams", resolved: true, resolvedBy: "user", resolvedAt: 30, messages: [{ id: "c2", authorId: "agent:thr_a", text: "First", at: 20 }] });
  expect(views[1]).toMatchObject({ quote: "crash rate", resolved: false, resolvedBy: null, messages: [{ text: "Second" }] });
});
