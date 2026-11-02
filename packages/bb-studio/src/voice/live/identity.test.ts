import { describe, expect, it, vi } from "vitest";
import { buildSeed, gatherSeed, memoryEssentials, RECENT_MESSAGES, SEED_BUDGET, SEED_CHAR_CAP, type SeedSources } from "./identity";

const MEMORY = "## Check-in\n- Look at the inbox\n- Chase the Kensico lead\n\n## Memory\n- Patrick drives to **Kensico** on Tuesdays.\n- The eBay fetcher runs nightly.";

function sources(overrides: Partial<SeedSources> = {}): SeedSources {
  return {
    bots: () => [
      { name: "Dot", role: "Keeps the week on track.", threadId: "thr_cos", memoryPageId: "pg_memory", primary: true },
      { name: "Scout", role: "Watches flight prices.", threadId: "thr_scout", memoryPageId: null, primary: false },
    ],
    memory: (pageId) => (pageId === "pg_memory" ? MEMORY : null),
    leadOf: (threadId) => (threadId === "thr_kensico" ? "Kensico" : null),
    runnerOf: (threadId) => (threadId === "thr_runner" ? { name: "eBay fetcher", job: "Fetch new listings nightly." } : null),
    thread: async (threadId) => ({
      thr_cos: { title: "Dot", project: null }, thr_scout: { title: "Scout", project: null },
      thr_kensico: { title: "Kensico lead", project: "Kensico" }, thr_runner: { title: "eBay fetcher run", project: "Kensico" },
      thr_plain: { title: "Launch review", project: "Website" },
    } as Record<string, { title: string; project: string | null }>)[threadId] ?? null,
    recent: async (threadId) => [{ role: "user", text: `What's new in ${threadId}?` }, { role: "assistant", text: "The **domain** renewal is due Friday." }],
    loops: () => ({ needsYouNow: ["Reply to Dana", "Sign off the Lisbon budget"], comingUp: ["Renew the domain"] }),
    ...overrides,
  };
}

describe("the identity seed", () => {
  it("launched from the Chief of Staff (or from nowhere): its name and role, memory, recent turns and open loops", async () => {
    for (const threadId of ["thr_cos", null, undefined]) {
      const seed = buildSeed((await gatherSeed(threadId, sources()))!);
      expect(seed.identity).toEqual({ kind: "cos", label: "Chief of Staff", name: "Dot", threadId: "thr_cos" });
      expect(seed.missing).toEqual([]);
      expect(seed.text).toContain("You are Dot, the user's Chief of Staff.");
      expect(seed.text).toContain("Role: Keeps the week on track.");
      expect(seed.text).toContain("Patrick drives to Kensico on Tuesdays.");
      // The Memory page's essentials, not its check-in list.
      expect(seed.text).not.toContain("Chase the Kensico lead");
      expect(seed.text).toContain("Needs you now:\n- Reply to Dana\n- Sign off the Lisbon budget\nComing up:\n- Renew the domain");
      expect(seed.text).toContain("User: What's new in thr_cos?\nDot: The domain renewal is due Friday.");
    }
  });

  it("launched from another thread: its title, its role from Studio's records, recent context and project; no CoS memory or loops", async () => {
    const lead = buildSeed((await gatherSeed("thr_kensico", sources()))!);
    expect(lead.identity).toEqual({ kind: "lead", label: "Kensico lead", name: "Kensico lead", threadId: "thr_kensico" });
    expect(lead.text).toContain('You speak for the thread "Kensico lead".\nRole: Lead of the Kensico project.\nProject: Kensico');
    expect(lead.text).toContain("Kensico lead: The domain renewal is due Friday.");
    expect(lead.text).not.toMatch(/Memory|Open loops|Reply to Dana/);
    expect(lead.missing).toEqual([]);

    const bot = buildSeed((await gatherSeed("thr_scout", sources()))!);
    expect(bot.identity).toMatchObject({ kind: "bot", label: "Scout", threadId: "thr_scout" });
    expect(bot.text).toContain("You are Scout, one of the user's Bots.\nRole: Watches flight prices.");

    const runner = buildSeed((await gatherSeed("thr_runner", sources()))!);
    expect(runner.identity).toMatchObject({ kind: "runner", label: "eBay fetcher run" });
    expect(runner.text).toContain('Role: The runner "eBay fetcher". Its job: Fetch new listings nightly.');

    const plain = buildSeed((await gatherSeed("thr_plain", sources()))!);
    expect(plain.identity).toEqual({ kind: "thread", label: "Launch review", name: "Launch review", threadId: "thr_plain" });
    expect(plain.text).toBe('You speak for the thread "Launch review".\nProject: Website\n\nLately in this chat (oldest first):\nUser: What\'s new in thr_plain?\nLaunch review: The domain renewal is due Friday.');
  });

  it("an unknown launching thread falls back to the Chief of Staff", async () => {
    const seed = buildSeed((await gatherSeed("thr_gone", sources()))!);
    expect(seed.identity).toMatchObject({ kind: "cos", threadId: "thr_cos" });
  });

  it("stays under the cap however big the sources are, keeping the newest messages", async () => {
    const huge = "word ".repeat(20_000);
    const recent = Array.from({ length: 40 }, (_, index) => ({ role: (index % 2 ? "assistant" : "user") as "user" | "assistant", text: `Message ${index}: ${huge}` }));
    const seed = buildSeed((await gatherSeed("thr_cos", sources({
      bots: () => [{ name: "Dot", role: huge, threadId: "thr_cos", memoryPageId: "pg_memory", primary: true }],
      memory: () => `## Memory\n${huge}`,
      recent: async () => recent,
      loops: () => ({ needsYouNow: Array.from({ length: 50 }, (_, index) => `Loop ${index} ${huge}`), comingUp: Array.from({ length: 50 }, () => huge) }),
    })))!);
    expect(seed.text.length).toBeLessThanOrEqual(SEED_CHAR_CAP);
    expect(memoryEssentials(`## Memory\n${huge}`).length).toBeLessThanOrEqual(SEED_BUDGET.memory);
    expect(seed.text).toContain(`Message 39:`);
    expect(seed.text).not.toContain(`Message ${39 - RECENT_MESSAGES}:`);
    expect(seed.text.match(/^- Loop \d+/gm)).toHaveLength(6);
  });

  it("says what's missing when there's no Memory page, loops are off or the timeline can't be read", async () => {
    const seed = buildSeed((await gatherSeed("thr_cos", sources({
      memory: () => null,
      loops: () => null,
      recent: async () => { throw new Error("timeline down"); },
    })))!);
    expect(seed.identity.kind).toBe("cos");
    expect(seed.missing).toEqual(["memory", "loops", "recent"]);
    expect(seed.text).not.toMatch(/Memory \(|Open loops|Lately in this chat/);
    expect(seed.text).toContain("Not available now: memory, loops, recent. If asked about it, don't guess");

    const throwing = buildSeed((await gatherSeed("thr_cos", sources({ loops: () => { throw new Error("off"); }, memory: () => "  " })))!);
    expect(throwing.missing).toEqual(["memory", "loops"]);
  });

  it("reads each source once per start, and the CoS's recent turns from its own chat", async () => {
    const recent = vi.fn(async () => []);
    const loops = vi.fn(() => ({ needsYouNow: [], comingUp: [] }));
    const seed = buildSeed((await gatherSeed(null, sources({ recent, loops })))!);
    expect(recent).toHaveBeenCalledTimes(1);
    expect(recent).toHaveBeenCalledWith("thr_cos");
    expect(loops).toHaveBeenCalledTimes(1);
    expect(seed.text).toContain("Nothing needs the user right now.");
    expect(seed.text).toContain("Lately in this chat: nothing yet.");
  });
});
