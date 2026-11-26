import { describe, expect, it, vi } from "vitest";
import { buildSeed, gatherSeed, memoryEssentials, RECENT_MESSAGES, SEED_BUDGET, SEED_CHAR_CAP, type SeedSources } from "./identity";

const MEMORY = "## Check-in\n- Look at the inbox\n- Chase the Larkspur lead\n\n## Memory\n- Sam drives to **Larkspur** on Tuesdays.\n- The eBay fetcher runs nightly.";

function sources(overrides: Partial<SeedSources> = {}): SeedSources {
  return {
    bots: () => [
      { id: "bot_dot", name: "Dot", role: "Keeps the week on track.", threadId: "thr_cos", primary: true },
      { id: "bot_scout", name: "Scout", role: "Watches flight prices.", threadId: "thr_scout", primary: false },
    ],
    memory: (botId) => (botId === "bot_dot" ? MEMORY : null),
    leadOf: (threadId) => (threadId === "thr_larkspur" ? "Larkspur" : null),
    runnerOf: (threadId) => (threadId === "thr_runner" ? { name: "eBay fetcher", job: "Fetch new listings nightly." } : null),
    thread: async (threadId) => ({
      thr_cos: { title: "Dot", project: null }, thr_scout: { title: "Scout", project: null },
      thr_larkspur: { title: "Larkspur lead", project: "Larkspur" }, thr_runner: { title: "eBay fetcher run", project: "Larkspur" },
      thr_plain: { title: "Launch review", project: "Website" },
    } as Record<string, { title: string; project: string | null }>)[threadId] ?? null,
    recent: async (threadId) => [{ role: "user", text: `What's new in ${threadId}?` }, { role: "assistant", text: "The **domain** renewal is due Friday." }],
    ...overrides,
  };
}

describe("the identity seed", () => {
  it("launched from the Chief of Staff (or from nowhere): its name and role, memory and recent turns", async () => {
    for (const threadId of ["thr_cos", null, undefined]) {
      const seed = buildSeed((await gatherSeed(threadId, sources()))!);
      expect(seed.identity).toEqual({ kind: "cos", label: "Chief of Staff", name: "Dot", threadId: "thr_cos" });
      expect(seed.missing).toEqual([]);
      expect(seed.text).toContain("You are Dot, the user's Chief of Staff.");
      expect(seed.text).toContain("Role: Keeps the week on track.");
      expect(seed.text).toContain("Sam drives to Larkspur on Tuesdays.");
      // The Memory page's essentials, not its check-in list.
      expect(seed.text).not.toContain("Chase the Larkspur lead");
      expect(seed.text).not.toMatch(/Todos|Needs you now/);
      expect(seed.text).toContain("User: What's new in thr_cos?\nDot: The domain renewal is due Friday.");
    }
  });

  it("launched from another thread: its title, its role from Studio's records, recent context and project; no CoS memory", async () => {
    const lead = buildSeed((await gatherSeed("thr_larkspur", sources()))!);
    expect(lead.identity).toEqual({ kind: "lead", label: "Larkspur lead", name: "Larkspur lead", threadId: "thr_larkspur" });
    expect(lead.text).toContain('You speak for the thread "Larkspur lead".\nRole: Lead of the Larkspur project.\nProject: Larkspur');
    expect(lead.text).toContain("Larkspur lead: The domain renewal is due Friday.");
    expect(lead.text).not.toMatch(/Memory/);
    expect(lead.missing).toEqual([]);

    const bot = buildSeed((await gatherSeed("thr_scout", sources()))!);
    expect(bot.identity).toMatchObject({ kind: "bot", label: "Scout", threadId: "thr_scout" });
    expect(bot.text).toContain("You are Scout, one of the user's Bots.\nRole: Watches flight prices.");

    const runner = buildSeed((await gatherSeed("thr_runner", sources()))!);
    expect(runner.identity).toMatchObject({ kind: "runner", label: "eBay fetcher run" });
    expect(runner.text).toContain('Role: The runner "eBay fetcher". Its job: Fetch new listings nightly.');

    const plain = buildSeed((await gatherSeed("thr_plain", sources()))!);
    expect(plain.identity).toEqual({ kind: "thread", label: "Launch review", name: "Launch review", threadId: "thr_plain" });
    expect(plain.text).toContain('You speak for the thread "Launch review".\nProject: Website\n\nYour latest reply in this chat:\nThe domain renewal is due Friday.\n\nLately in this chat (oldest first):\nUser: What\'s new in thr_plain?\nLaunch review: The domain renewal is due Friday.');
  });

  it("an unknown launching thread falls back to the Chief of Staff", async () => {
    const seed = buildSeed((await gatherSeed("thr_gone", sources()))!);
    expect(seed.identity).toMatchObject({ kind: "cos", threadId: "thr_cos" });
  });

  it("stays under the cap however big the sources are, keeping the newest messages", async () => {
    const huge = "word ".repeat(20_000);
    const recent = Array.from({ length: 40 }, (_, index) => ({ role: (index % 2 ? "assistant" : "user") as "user" | "assistant", text: `Message ${index}: ${huge}` }));
    const seed = buildSeed((await gatherSeed("thr_cos", sources({
      bots: () => [{ id: "bot_dot", name: "Dot", role: huge, threadId: "thr_cos", primary: true }],
      memory: () => `## Memory\n${huge}`,
      recent: async () => recent,
    })))!);
    expect(seed.text.length).toBeLessThanOrEqual(SEED_CHAR_CAP);
    expect(memoryEssentials(`## Memory\n${huge}`).length).toBeLessThanOrEqual(SEED_BUDGET.memory);
    expect(seed.text).toContain(`Message 39:`);
    expect(seed.text).not.toContain(`Message ${39 - RECENT_MESSAGES}:`);
  });

  it("says what's missing when there's no Memory page or the timeline can't be read", async () => {
    const seed = buildSeed((await gatherSeed("thr_cos", sources({
      memory: () => null,
      recent: async () => { throw new Error("timeline down"); },
    })))!);
    expect(seed.identity.kind).toBe("cos");
    expect(seed.missing).toEqual(["memory", "recent"]);
    expect(seed.text).not.toMatch(/Memory \(|Lately in this chat/);
    expect(seed.text).toContain("Not available now: memory, recent. If asked about it, don't guess");

    const throwing = buildSeed((await gatherSeed("thr_cos", sources({ memory: () => { throw new Error("off"); } })))!);
    expect(throwing.missing).toEqual(["memory"]);
  });

  it("reads each source once per start, and the CoS's recent turns from its own chat", async () => {
    const recent = vi.fn(async () => []);
    const memory = vi.fn(() => MEMORY);
    const seed = buildSeed((await gatherSeed(null, sources({ recent, memory })))!);
    expect(recent).toHaveBeenCalledTimes(1);
    expect(recent).toHaveBeenCalledWith("thr_cos");
    expect(memory).toHaveBeenCalledTimes(1);
    expect(seed.text).toContain("Lately in this chat: nothing yet.");
  });
});

it("keeps the latest assistant reply beyond recent-message clipping with one timeline read", async () => {
  const full = "The change preserves intent. ".repeat(45);
  const recent = vi.fn(async () => [{ role: "assistant" as const, text: `**${full}**` }, ...Array.from({ length: 8 }, () => ({ role: "user" as const, text: "And then?" }))]);
  const seed = buildSeed((await gatherSeed("thr_cos", sources({ recent })))!);
  expect(recent).toHaveBeenCalledTimes(1);
  expect(seed.text).toContain(`Your latest reply in this chat:\n${full.trim()}`);
  expect(seed.text.length).toBeLessThanOrEqual(SEED_CHAR_CAP);
});
