// Test fixtures for memory: a typical old Memory page (made up, modelled on
// how a Bot's Memory page grows: a check-in list, who the user is, systems,
// facts and decisions, preferences, people), and a host with a real
// migrated database, two Bots and in-memory pages and threads.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach } from "vitest";
import { MIGRATIONS } from "../migrations";
import { MemoryService, setBotMemoryPage, type BotThreadPlace } from "./service";
import { MemoryStore } from "./store";

export const MEMORY_PAGE = `# Chief of Staff's Memory

Notes the Bot keeps about Sam and the work. Edited by both.

## Check-in

- Anything waiting on Sam, or threads I started that finished, failed or stalled?
- Garage door sensor battery: remind on the 1st of the month.

## Who he is

Sam is a staff engineer in Portland, preparing for system design interviews.

## How he works

- Wants one recommendation, not a survey of options.
- Short reports in simple English; say what failed.
- Works on \`main\` with small commits.

## Hard rules

- Never send email on his behalf without asking.
- Read-only on the home server unless he approves a command.

## Systems

- **nas1:** Synology DS920+, reached over Tailscale at nas1.tail.
- Backups run Saturday 03:00–05:00; refused ports then are expected.
- Home Assistant lives on the Pi 4 in the hall closet.
  - Zigbee stick: SONOFF, on USB 2.

## Facts and decisions

- 2026-10-28: picked Hetzner over Fly for the side project (cost).
- Nov 6: launch outline gives high-level design 20 minutes.
- Decided on Oct 3 to drop the Notion export; Pages is the source.
- The dentist moved to Thursdays.

### Launch

- One 45-minute mock a day, top of the library first.

| Item | Due |
| --- | --- |
| Passport renewal | 2026-12-01 |
| Car registration | 2027-01-15 |

## Preferences

- Coffee: oat flat white.
- Prefers dark mode everywhere.

\`\`\`
alias gs="git status -sb"
\`\`\`

## People and places

- Alex (partner), Jo (sister, Seattle).
- Home: 12 Alder Lane.
`;

const dispose: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of dispose.splice(0)) await fn(); });

type Thread = { id: string; title: string; archived: boolean; parentThreadId?: string | null };

/** A Studio host with a migrated DB: Bots Dot (primary, thread thr_main) and Scout (thr_scout), pages and threads in memory. */
export async function memoryHost() {
  const { bb, harness } = createFakePluginHost({ pluginId: "studio" });
  dispose.push(() => harness.lifecycle.dispose());
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const insert = db.prepare("INSERT INTO bots (id, name, avatar, state, thread_id, heartbeat_was_on, created_at, updated_at) VALUES (?, ?, '🤖', 'active', ?, 0, ?, ?)");
  insert.run("bot_main", "Dot", "thr_main", 1, 1);
  insert.run("bot_scout", "Scout", "thr_scout", 2, 2);
  const pages = new Map<string, { title: string; markdown: string; updatedAt: number; icon: string }>();
  /** Every page write, by page id: the split must never write the old page. */
  const writes: string[] = [];
  let made = 0;
  const createPage = ({ title, markdown, icon }: { title: string; markdown: string; icon: string }) => {
    const id = `pg_new${++made}`;
    pages.set(id, { title, markdown, icon, updatedAt: Date.now() });
    writes.push(id);
    return id;
  };
  const threads = new Map<string, Thread>([
    ["thr_main", { id: "thr_main", title: "Dot", archived: false }],
    ["thr_scout", { id: "thr_scout", title: "Scout", archived: false }],
    ["thr_side", { id: "thr_side", title: "Launch prep", archived: true }],
    ["thr_worker", { id: "thr_worker", title: "Fable lead: sidebar rewrite", archived: false, parentThreadId: "thr_main" }],
    ["thr_runner", { id: "thr_runner", title: "Runner thread", archived: false }],
    ["thr_loose", { id: "thr_loose", title: "Someone else's thread", archived: false }],
  ]);
  const external = new Set<string>();
  /** Studio's record of conversations and workers (bot_threads), empty unless a test places threads. */
  const places = new Map<string, BotThreadPlace>();
  const memory = new MemoryService({
    store: new MemoryStore(db),
    bots: {
      list: () => (db.prepare("SELECT id, name, memory_page_id FROM bots ORDER BY created_at").all() as { id: string; name: string; memory_page_id: string | null }[])
        .map((row, index) => ({ id: row.id, name: row.name, primary: index === 0, kind: external.has(row.id) ? "external" as const : "studio" as const, memoryPageId: row.memory_page_id })),
      pageId: (botId) => (db.prepare("SELECT memory_page_id FROM bots WHERE id = ?").get(botId) as { memory_page_id: string | null } | undefined)?.memory_page_id ?? null,
      setPage: (botId, pageId) => setBotMemoryPage(db, botId, pageId),
    },
    pages: {
      meta: (pageId) => { const page = pages.get(pageId); return page ? { title: page.title, updatedAt: page.updatedAt } : null; },
      markdown: (pageId) => pages.get(pageId)?.markdown ?? null,
      create: createPage,
    },
    threads: { get: async (threadId) => { const thread = threads.get(threadId); return thread ? { title: thread.title, archived: thread.archived } : null; } },
    botThread: (threadId) => places.get(threadId) ?? null,
    acting: async (threadId) => threadId === "thr_main" ? { botId: "bot_main", via: "own" } : threadId === "thr_scout" ? { botId: "bot_scout", via: "own" }
      : threadId === "thr_runner" ? { botId: "bot_main", via: "runner" } : threadId === "thr_worker" ? { botId: "bot_main", via: "started" } : null,
    sideBot: (threadId) => threadId === "thr_side" ? "bot_main" : null,
    runnerName: (threadId) => threadId === "thr_runner" ? "staff sweep" : null,
    ownedBot: () => null,
    chainBot: (threadId) => threadId === "thr_main" ? "bot_main" : threadId === "thr_scout" ? "bot_scout" : null,
    ownBot: (threadId) => threadId === "thr_main" ? "bot_main" : threadId === "thr_scout" ? "bot_scout" : null,
    runnerBot: (threadId) => threadId === "thr_runner" ? "bot_main" : null,
    changed: () => {},
  });
  /** Gives a Bot an old Memory page, as Bots made before core profiles have. */
  const legacy = (botId: string, markdown = MEMORY_PAGE, updatedAt = new Date(2026, 10, 9, 18).getTime()) => {
    const id = `pg_old_${botId}`;
    pages.set(id, { title: "Chief of Staff's Memory", markdown, icon: "🧠", updatedAt });
    setBotMemoryPage(db, botId, id);
    return id;
  };
  return { bb, harness, db, memory, pages, writes, threads, external, legacy, createPage, places };
}
