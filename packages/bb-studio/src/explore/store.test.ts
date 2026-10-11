import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { ExploreStore, NEXT_LOG_MIGRATIONS } from "./store";
import { registerExplore } from "./register";

describe("the Next row's click log in Studio", () => {
  it("counts shown and clicked suggestions in stats", async () => {
    const db = new Database(":memory:");
    for (const sql of NEXT_LOG_MIGRATIONS) db.exec(sql);
    const store = new ExploreStore(db, () => Date.now());
    store.nextClicked({ threadId: "thr_1", messageId: "msg_1", kind: "reply", emoji: "👍", label: "Looks good" });
    store.nextClicked({ threadId: "thr_0", messageId: "msg_0", kind: "do", emoji: "📄", label: "Write it up" });
    const out = await registerExplore(db).cli(["stats"], {} as never);
    expect(out.stdout).toMatch(/do\t1\t1\t100%/);
    expect(out.stdout).toMatch(/reply\t1\t1\t100%/);
  });
});
