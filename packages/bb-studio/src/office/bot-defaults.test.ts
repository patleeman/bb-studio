import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { MIGRATIONS } from "../migrations";
import { migrateOfficeSpaces } from "./migration";
import { OfficeSpaceStore } from "./space-store";
import { botDefaults } from "./bot-defaults";

it("uses the bot project's Space defaults without changing explicit trust/model choices", () => {
  const db = new Database(":memory:");
  for (const migration of MIGRATIONS) db.exec(migration);
  migrateOfficeSpaces(db, { projectIds: ["folder"], projectForMember: () => undefined, logConflict: () => {} });
  const spaces = new OfficeSpaceStore(db), work = spaces.create({ name: "Work" });
  spaces.moveProject("folder", work.id);
  spaces.setSettings(work.id, { defaultTrust: "act", defaultBotModel: { providerId: "claude-code", model: "test-model" } });
  try {
    expect(botDefaults({ providerId: "codex", model: "" }, "folder", db)).toEqual({ providerId: "claude-code", model: "test-model", trust: "act", permissionMode: "auto" });
    expect(botDefaults({ providerId: "codex", model: "selected", trust: "ask" }, "folder", db)).toEqual({ providerId: "codex", model: "selected", trust: "ask", permissionMode: "accept-edits" });
    expect(botDefaults({ providerId: "codex", model: "" }, "proj_personal", db).trust).toBe("ask");
  } finally { db.close(); }
});
