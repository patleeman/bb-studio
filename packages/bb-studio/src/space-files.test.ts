import { describe, expect, it } from "vitest";
import { requireThreadInSpace } from "./space-files";

const bb = (threads: Record<string, { projectId: string | null }>) =>
  ({ sdk: { threads: { get: async ({ threadId }: { threadId: string }) => { if (!threads[threadId]) throw new Error("gone"); return threads[threadId]; } } } }) as never;
const owner = (thread: { id: string; projectId: string | null }) => (thread.projectId === "proj_a" ? "space_a" : "space_b");

describe("reading a thread's files through a space", () => {
  it("allows a thread the space owns", async () => {
    await expect(requireThreadInSpace(bb({ t1: { projectId: "proj_a" } }), owner, "space_a", "t1")).resolves.toBeUndefined();
  });
  it("refuses a thread from another space or a missing one", async () => {
    await expect(requireThreadInSpace(bb({ t1: { projectId: "proj_a" } }), owner, "space_b", "t1")).rejects.toThrow(/isn't in this space/);
    await expect(requireThreadInSpace(bb({}), owner, "space_a", "nope")).rejects.toThrow(/isn't in this space/);
  });
});
