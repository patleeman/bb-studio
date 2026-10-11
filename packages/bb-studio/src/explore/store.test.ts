import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { ExploreStore, NEXT_LOG_MIGRATIONS } from "./store";
import { registerExplore } from "./register";

describe("the Next row's click log in Studio", () => {
  it("takes the old explore.db's suggestions once, keeping Studio's own counts, and reports them in stats", async () => {
    const db = new Database(":memory:");
    for (const sql of NEXT_LOG_MIGRATIONS) db.exec(sql);
    const now = Date.now();
    const store = new ExploreStore(db, () => now);
    store.nextClicked({ threadId: "thr_1", messageId: "msg_1", kind: "reply", emoji: "👍", label: "Looks good" });
    const rows = [
      { key: "thr_1:msg_1:reply:looks good", threadId: "thr_1", messageId: "msg_1", kind: "reply", emoji: "👍", label: "Looks good", shownAt: now - 1000, clickedAt: now - 500, clicks: 4 },
      { key: "thr_0:msg_0:do:write it up", threadId: "thr_0", messageId: "msg_0", kind: "do", emoji: "📄", label: "Write it up", shownAt: now - 2000, clickedAt: now - 1500, clicks: 1 },
    ];
    const existing = db.prepare("SELECT key FROM next_suggestions").all() as { key: string }[];
    rows[0]!.key = existing[0]!.key;
    expect(store.importNext(rows)).toEqual({ imported: 1, existing: 1 });
    expect(store.importNext(rows)).toEqual({ imported: 0, existing: 2 });
    expect(db.prepare("SELECT clicks FROM next_suggestions WHERE key = ?").get(rows[0]!.key)).toEqual({ clicks: 1 });
    const out = await registerExplore(db).cli(["stats"], {} as never);
    expect(out.stdout).toMatch(/do\t1\t1\t100%/);
    expect(out.stdout).toMatch(/reply\t1\t1\t100%/);
  });
});
