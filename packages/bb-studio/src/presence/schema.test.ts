import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "../migrations";
import { BUILTIN_FORMS } from "./forms";
import { presenceLook } from "./look";
import { DEFAULT_PALETTE, DEFAULT_PALETTE_LIGHT, paletteFromColor, paletteFromTheme, paletteHex } from "./palette";
import { DEFAULT_FORMS, defaultPresence, parsePresence, presenceSchema } from "./schema";

describe("a Bot's presence", () => {
  it("defaults to a built-in form: the tesseract for the primary Bot, a steady pick per Bot otherwise", () => {
    expect(defaultPresence("bot", true)).toEqual({ form: "tesseract", color: { source: "theme" }, motion: 1 });
    for (const id of ["bot_a", "bot_b", "bot_kq81", "home"]) {
      expect(DEFAULT_FORMS).toContain(defaultPresence(id).form);
      expect(defaultPresence(id)).toEqual(defaultPresence(id));
    }
    expect(new Set(["a", "b", "c", "d", "e", "f"].map((id) => defaultPresence(id).form)).size).toBeGreaterThan(1);
  });

  it("reads a stored presence and falls back to the default for anything else", () => {
    const stored = { form: "klein", color: { source: "custom", hex: "#12abef" }, motion: 1.5 };
    expect(parsePresence(JSON.stringify(stored), "bot")).toEqual(stored);
    for (const bad of [null, undefined, "", "{", "[]", JSON.stringify({ form: "klein" }), JSON.stringify({ ...stored, motion: 9 }), JSON.stringify({ ...stored, form: "Not An Id" }), JSON.stringify({ ...stored, color: { source: "custom", hex: "red" } })]) {
      expect(parsePresence(bad, "bot", true)).toEqual(defaultPresence("bot", true));
    }
    expect(presenceSchema.safeParse({ ...stored, form: "origami-crane" }).success).toBe(true);
  });

  it("the migration adds the column and the table and leaves old avatar fields alone", () => {
    const db = new Database(":memory:");
    const at = MIGRATIONS.findIndex((migration) => migration.includes("presence_json"));
    for (const migration of MIGRATIONS.slice(0, at)) db.exec(migration);
    db.prepare("INSERT INTO bots (id, name, avatar, state, heartbeat_was_on, shape, color, avatar_image_id, created_at, updated_at) VALUES ('bot_old', 'Old', '🦉', 'active', 0, 'star', '#e5484d', 'bai_1', 1, 1)").run();
    db.exec(MIGRATIONS[at]!);
    const row = db.prepare("SELECT * FROM bots WHERE id = 'bot_old'").get() as Record<string, unknown>;
    expect(row).toMatchObject({ avatar: "🦉", shape: "star", color: "#e5484d", avatar_image_id: "bai_1", presence_json: null });
    const presence = parsePresence(row.presence_json as null, "bot_old");
    expect(BUILTIN_FORMS).toContain(presence.form);
    expect(presence.color).toEqual({ source: "theme" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM studio_presences").get()).toEqual({ n: 0 });
  });
});

describe("a presence's colors", () => {
  const theme = (palette: [string, string, string, string], canvas: string, accent: string, mode: "light" | "dark") => ({ palette, variants: { [mode]: { canvas, accent } } }) as never;

  it("come from the theme: its accent, then its palette, skipping colors that vanish on the ground", () => {
    const miami = presenceLook({ color: { source: "theme" } }, theme(["#0e0626", "#ff4fd8", "#4ff0ff", "#ffab45"], "#0e0626", "#ff4fd8", "dark"), "dark");
    expect(miami.light).toBe(false);
    expect(paletteHex(miami.palette)[0]).toBe("#ff4fd8");
    expect(paletteHex(miami.palette)[2]).toBe("#4ff0ff");
    const forest = paletteFromTheme(["#141a22", "#e4f27c", "#1f272e", "#e4f27c"]);
    expect(paletteHex(forest)[0]).toBe("#e4f27c");
    expect(paletteHex(forest)).not.toContain("#1f272e");
    expect(paletteFromTheme(["#000000", "#111111", "#222222"])).toEqual(DEFAULT_PALETTE);
  });

  it("follow the theme's mode, and a light ground is drawn light", () => {
    const zen = presenceLook({ color: { source: "theme" } }, theme(["#e7ddc9", "#6c675e", "#55702f", "#b0402a"], "#e7ddc9", "#b0402a", "light"), "dark");
    expect(zen.light).toBe(true);
    expect(paletteHex(zen.palette)[0]).toBe("#b0402a");
    expect(presenceLook({ color: { source: "theme" } }, null, "light")).toEqual({ palette: DEFAULT_PALETTE_LIGHT, light: true });
    expect(presenceLook({ color: { source: "theme" } }, null, "dark")).toEqual({ palette: DEFAULT_PALETTE, light: false });
  });

  it("or from one custom color, with a depth and a highlight derived from it", () => {
    const look = presenceLook({ color: { source: "custom", hex: "#00aaff" } }, null, "dark");
    const [main, depth, highlight] = paletteHex(look.palette);
    expect(main).toBe("#00aaff");
    expect(new Set([main, depth, highlight]).size).toBe(3);
    expect(paletteFromColor([128, 128, 128])[1]).not.toEqual([128, 128, 128]);
  });
});
