import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { IMPORT_BATCH_CHARS, type ImportDesign } from "@bb-studio/kit/design-contract";
// Studio's real store, so the copy is checked against what Studio does with it.
import { DESIGN_MIGRATIONS, DesignStore } from "../../bb-studio/src/design/server/store";
import { MIGRATED, MIGRATED_STYLE, MIGRATIONS, batches, migrate, type Markers, type StudioImport } from "./migrate";

function oldPlugin() {
  const db = new Database(":memory:");
  for (const statement of MIGRATIONS) db.exec(statement);
  const store = new DesignStore(db);
  const add = (name: string) => {
    const row = store.create({ name, projectId: "proj_1", by: "agent" });
    store.setThread(row.id, "thr_1");
    store.setRound(row.id, 1, { title: "First", intro: "Two options" }, "agent");
    store.writeScreen(row.id, { id: "1a", html: `<h1>${name}</h1>`, caption: "Desktop" }, "agent");
    store.addComment(row.id, { screenId: "1a", selector: "h1", elementHtml: "<h1></h1>", elementText: name, body: "Bigger" });
    return row.id;
  };
  return { db, store, add };
}

function studio(options: { failRows?: number } = {}) {
  const db = new Database(":memory:");
  for (const statement of DESIGN_MIGRATIONS) db.exec(statement);
  const store = new DesignStore(db);
  const calls = { rows: 0 };
  let failRows = options.failRows ?? 0;
  const collect = <T extends { id: string }>(items: T[], one: (item: T) => ReturnType<DesignStore["importDesign"]>) => {
    const result = { imported: [] as string[], existing: [] as string[], skipped: [] as { id: string; reason: string }[] };
    for (const item of items) {
      const outcome = one(item);
      if ("reason" in outcome) result.skipped.push({ id: item.id, reason: outcome.reason });
      else result[outcome.outcome].push(item.id);
    }
    return result;
  };
  const api: StudioImport = {
    importRows: async (designs) => {
      calls.rows++;
      if (failRows-- > 0) throw new Error("Studio isn't running");
      return collect(designs, (item) => store.importDesign(item));
    },
    importStyles: async (styles) => collect(styles, (item) => store.importStyle(item)),
  };
  return { store, api, calls };
}

function markers(): Markers & { keys(): string[] } {
  const map = new Map<string, unknown>();
  return { get: async (key) => map.get(key), set: async (key, value) => { map.set(key, value); }, keys: () => [...map.keys()] };
}

describe("copying the old Studio Design plugin into Studio", () => {
  it("keeps the old plugin's migrations byte for byte, the statements Studio appends", () => {
    expect(MIGRATIONS).toEqual([...DESIGN_MIGRATIONS]);
    expect(createHash("sha256").update(MIGRATIONS.join("\n--\n")).digest("hex")).toMatchInlineSnapshot(`"ce68494b495935e0b61b17548fe22f4e5bbf68f9b71b3dbc1cb78b07b92325d6"`);
  });

  it("copies designs with their rounds, screens, comments and thread, and saved styles, then reruns as a no-op", async () => {
    const old = oldPlugin();
    const a = old.add("Onboarding"), b = old.add("Deck");
    old.store.saveStyle({ name: "Editorial", notes: "Serif", css: ":root{}", designId: a, screenId: "1a" });
    const target = studio();
    const marks = markers();
    expect(await migrate(old.db, target.api, marks)).toEqual({ complete: true, total: 3, copied: 3, skipped: [] });
    const view = target.store.view(a)!;
    expect(view).toMatchObject({ name: "Onboarding", projectId: "proj_1", threadId: "thr_1", rounds: [{ title: "First", screens: [{ id: "1a", caption: "Desktop" }] }], comments: [{ body: "Bigger" }] });
    expect(target.store.get(a)!.updated_at).toBe(old.store.get(a)!.updated_at);
    expect(target.store.get(b)).not.toBeNull();
    expect(target.store.styles()).toMatchObject([{ name: "Editorial", source_design_id: a }]);
    expect(marks.keys().sort()).toEqual([`${MIGRATED}${a}`, `${MIGRATED}${b}`, `${MIGRATED_STYLE}${old.store.styles()[0]!.id}`].sort());
    const calls = target.calls.rows;
    expect(await migrate(old.db, target.api, marks)).toEqual({ complete: true, total: 3, copied: 3, skipped: [] });
    expect(target.calls.rows).toBe(calls);
  });

  it("lists a malformed row with the reason, keeps it, and still completes", async () => {
    const old = oldPlugin();
    const a = old.add("Fine");
    old.db.prepare("INSERT INTO designs (id, name, created_at, updated_at) VALUES ('dsn_bad', 'Bad', -1, 1)").run();
    const result = await migrate(old.db, studio().api, markers());
    expect(result).toMatchObject({ complete: true, total: 2, copied: 1, skipped: [{ id: "dsn_bad", reason: expect.stringContaining("createdAt") }] });
    expect(a).toBeTruthy();
  });

  it("stays incomplete while Studio is down, and finishes on retry", async () => {
    const old = oldPlugin();
    old.add("One");
    const target = studio({ failRows: 1 });
    const marks = markers();
    await expect(migrate(old.db, target.api, marks)).rejects.toThrow("isn't running");
    expect(await migrate(old.db, target.api, marks)).toMatchObject({ complete: true, copied: 1 });
  });

  it("batches by count and by HTML size, a large design alone", () => {
    const item = (id: string, chars: number) => ({ id, screens: [{ html: "x".repeat(chars) }] }) as unknown as ImportDesign;
    expect(batches([item("a", 10), item("b", IMPORT_BATCH_CHARS), item("c", 10)]).map((batch) => batch.map((each) => each.id))).toEqual([["a"], ["b"], ["c"]]);
    expect(batches(Array.from({ length: 150 }, (_, index) => item(String(index), 1))).map((batch) => batch.length)).toEqual([100, 50]);
  });
});
