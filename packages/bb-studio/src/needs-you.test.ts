import { describe, expect, it } from "vitest";
import { commentNeeds, needsYouData, respondToNeed } from "./needs-you";

const item = { pluginId: "pages", id: "p1", title: "Plan", href: "/plugins/pages/pages/p1", projectId: "project", archived: false };
const comment = (id: string, parentId: string | null, kind: "user" | "agent", body: string, resolvedAt: number | null = null) =>
  ({ id, ref: { pluginId: "pages", id: "p1" }, parentId, anchor: null, actor: { kind }, body, createdAt: 100, resolvedAt });

describe("Needs you", () => {
  it("shows replies to the user and mentions only while their thread is open", () => {
    const parent = comment("root", null, "user", "Please review");
    const reply = comment("reply", "root", "agent", "Ready for you");
    const mention = comment("mention", null, "agent", "@user please check");
    expect(commentNeeds([parent, reply, mention], item as never).map((entry) => entry.kind)).toEqual(["reply", "mention"]);
    expect(commentNeeds([{ ...parent, resolvedAt: 200 }, reply, mention], item as never).map((entry) => entry.kind)).toEqual(["mention"]);
  });

  it("derives current requests and drops resolved sources", async () => {
    let pending = true;
    let attentionOpen = true;
    let review = true;
    const sdk = {
      threads: {
        list: async () => [{ id: "t1", title: "Thread", titleFallback: null, hasPendingInteraction: pending }],
        interactions: { list: async () => pending ? [{ id: "i1", status: "pending", payload: { kind: "approval" }, createdAt: 1 }] : [] },
      },
      plugins: { callRpc: async ({ outputSchema }: { outputSchema: { parse: (value: unknown) => unknown } }) => outputSchema.parse({ items: attentionOpen ? [{ id: "a1", roomId: "r1", reason: "decision", createdAt: 1, channelName: "Team", message: { id: "m1", text: "Choose" } }] : [], nextOffset: null }) },
    };
    const services = { openComments: () => [] };
    const comments = { list: async () => [] };
    const tasks = () => [{ id: "task", title: "Task", status: review ? "review" : "done", due: null, projectId: "project", archived: false }];
    const read = () => needsYouData(sdk as never, services as never, comments as never, [], tasks(), [{ id: "r1", projectId: "project" }], "project");
    expect((await read()).map((entry) => entry.kind)).toEqual(["approval", "review", "attention"]);
    pending = false; attentionOpen = false; review = false;
    expect(await read()).toEqual([]);
  });

  it("answers one free-text question through the SDK", async () => {
    const sent: unknown[] = [];
    const sdk = { threads: { interactions: {
      get: async () => ({ status: "pending", payload: { kind: "user_question", questions: [{ id: "q1", allowFreeText: true }] } }),
      respond: async (input: unknown) => { sent.push(input); },
    } } };
    await respondToNeed(sdk as never, { threadId: "t1", interactionId: "i1", action: "answer", answer: "  Yes  " });
    expect(sent).toEqual([{ threadId: "t1", interactionId: "i1", value: { kind: "user_answer", answers: { q1: { selected: [], freeText: "Yes" } } } }]);
  });
});
