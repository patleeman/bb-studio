import { describe, expect, it, vi } from "vitest";
import type { NewThreadRequest } from "@get-bb/plugin-sdk";
import { startDiscussion } from "./discussion";
import { discussionHref, discussionPrompt } from "./shared";
import type { PostRow } from "./store";

const post = { id: "post_release", title: "Updated release window", author: "Atlas", channel_name: "launch", project_id: "source_project" } as PostRow;
const request = {
  projectId: "selected_project", providerId: "codex", model: "gpt-6.1-sol", reasoningLevel: "high", permissionMode: "auto",
  serviceTier: "fast", executionInputSources: { model: "explicit", providerId: "explicit" }, environment: {}, sendAt: 1_900_000_000_000,
  input: [{ type: "text", text: "Review my draft", mentions: [] }, { type: "image", url: "data:image/png;base64,YQ==" }, { type: "file", path: "release.txt" }],
} as NewThreadRequest;

describe("Feed discussion creation", () => {
  it("uses the selected post and retains the native request and attachments", async () => {
    const get = vi.fn(() => post);
    const spawn = vi.fn(async (_request: NewThreadRequest) => ({ id: "new_discussion" }));
    expect(await startDiscussion(post.id, request, get, spawn)).toEqual({ threadId: "new_discussion" });
    expect(get).toHaveBeenCalledWith(post.id);
    const sent = spawn.mock.calls[0]![0] as unknown as NewThreadRequest;
    expect(sent).toEqual({ ...request, input: [expect.objectContaining({ type: "text", text: expect.stringContaining(`feed_read id ${post.id}`) }), ...request.input] });
    expect((sent.input[0] as { text: string }).text).toContain("Updated release window");
    expect((sent.input[0] as { text: string }).text).toContain("Atlas in #launch");
    for (let i = 0; i < request.input.length; i++) expect(sent.input[i + 1]).toBe(request.input[i]);
    expect(sent.projectId).toBe("selected_project");
  });

  it("does not create a thread for a deleted post", async () => {
    const spawn = vi.fn();
    await expect(startDiscussion(post.id, request, () => null, spawn)).rejects.toThrow("That feed post is gone.");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("propagates spawn failures without losing the submitted input", async () => {
    const before = structuredClone(request);
    await expect(startDiscussion(post.id, request, () => post, async () => { throw new Error("Offline"); })).rejects.toThrow("Offline");
    expect(request).toEqual(before);
  });

  it("gives each post a canonical discussion route and keeps tool instructions out of the draft", () => {
    expect(discussionHref(post.id)).toBe("/plugins/feed/feed/post_release/discussion");
    expect(discussionPrompt({ id: post.id, title: post.title, author: post.author, channelName: post.channel_name })).toBe('Let\'s discuss "Updated release window".\n\n');
  });
});
