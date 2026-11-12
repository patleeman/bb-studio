import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { MIGRATIONS } from "../migrations";
import { THEME_TOOLS, themeTools, type ThemeTool } from "./agent-tools";
import { defaultAppearance, type Appearance } from "./appearance";
import { NORD } from "./builtin/classic";
import { DEEP_SEA } from "./builtin/deep-sea";
import { GRID } from "./builtin/grid";
import { checkTheme, type CheckLine } from "./checks";
import { ThemeGpuRouter } from "./gpu-server";
import { handleGpuRequest } from "./gpu";
import { mergeTheme, ThemeService, type ThemeBot } from "./service";
import { ThemeStore } from "./store";
import { THEME_TEMPLATE } from "./template";

function setup(options: { measure?: (theme: unknown) => Promise<CheckLine[] | null> } = {}) {
  const db = new Database(":memory:");
  for (const migration of MIGRATIONS) db.exec(migration);
  let at = 1000;
  const store = new ThemeStore(db, () => (at += 1));
  const bots: ThemeBot[] = [
    { id: "cos", name: "Chief of Staff", appearance: null },
    { id: "home", name: "Home", appearance: defaultAppearance(GRID) },
  ];
  const setAppearance = vi.fn(async (botId: string, appearance: Appearance | null) => { bots.find((bot) => bot.id === botId)!.appearance = appearance; });
  const service = new ThemeService({ store, bots: () => bots, setAppearance, ...(options.measure ? { measure: options.measure } : {}) });
  const tools = themeTools({
    service,
    creator: async (threadId) => (threadId === "home-thread" ? { name: "Home", botId: "home" } : { name: "Chief of Staff", botId: "cos" }),
    resolveBot: async (ref) => {
      if (!ref) return { id: "cos", name: "Chief of Staff" };
      const bot = bots.find((each) => each.id === ref || each.name.toLowerCase() === ref.toLowerCase());
      return bot ? { id: bot.id, name: bot.name } : `No Bot ${ref}.`;
    },
  });
  const tool = (name: (typeof THEME_TOOLS)[number]) => tools.find((each) => each.name === name)! as ThemeTool & { execute(input: unknown, ctx: { threadId?: string }): Promise<string> };
  return { store, service, bots, setAppearance, tool };
}

const ember = () => ({ ...structuredClone(THEME_TEMPLATE), id: "ember", name: "Ember" });

describe("the template", () => {
  it("passes every check as written", () => {
    const report = checkTheme(THEME_TEMPLATE);
    expect(report.results.filter((line) => !line.pass)).toEqual([]);
    expect(report.pass).toBe(true);
  });
});

describe("theme tools", () => {
  it("registers the five tools, and theme_create's description carries the shader contract and the template", () => {
    const { tool } = setup();
    expect(THEME_TOOLS).toEqual(["theme_list", "theme_create", "theme_update", "theme_apply", "theme_delete"]);
    const description = tool("theme_create").description;
    for (const part of ["uniform vec3 u_palette[4];", "u_workers", "u_ripples", "gl_FragColor", "backdrop.light", '"id": "northern-lights"']) expect(description).toContain(part);
  });

  it("theme_list lists built-ins and stored themes with kind, maker and the Bots using each", async () => {
    const { tool, service } = setup();
    await service.create(ember(), { name: "Chief of Staff", botId: "cos" });
    const text = await tool("theme_list").execute({}, {});
    const lines = text.split("\n");
    expect(lines).toContain("grid\tGrid (scene, builtin, dark) · used by Home");
    expect(lines).toContain("nord\tNord (classic, builtin, dark)");
    expect(lines.at(-1)).toBe("ember\tEmber (scene, stored, dark) · made by Chief of Staff");
    expect(JSON.parse(await tool("theme_list").execute({ id: "ember" }, {}))).toMatchObject({ id: "ember", kind: "scene" });
  });

  it("theme_create saves a passing theme with its maker, and the report", async () => {
    const { tool, store } = setup();
    const text = await tool("theme_create").execute({ theme: ember() }, { threadId: "home-thread" });
    expect(text).toMatch(/^Saved ember \(Ember\)\./);
    expect(text).toContain("Checks passed for ember:");
    expect(text).toContain("pass  frame-time  Static estimate, no WebGL here:");
    expect(store.records()).toMatchObject([{ theme: { id: "ember" }, creator: { name: "Home", botId: "home" } }]);
  });

  it("theme_create saves nothing when a check fails and names each failure", async () => {
    const { tool, store } = setup();
    const murky = ember();
    murky.variants.dark!.ink = "#0a0d14";
    murky.scene = { ...murky.scene, kind: "shader", source: "void main() { gl_FragColor = vec4(1.0); }", uniforms: { u_bands: 9 } } as typeof murky.scene;
    const text = await tool("theme_create").execute({ theme: murky }, {});
    expect(text).toMatch(/^Not saved\. Nothing changed\./);
    expect(text).toMatch(/- contrast:dark:transcript: dark transcript: .*, text 1\.0\d \(min 4\.5\)/);
    expect(text).toContain("- shader: u_bands has a value but no declaration.");
    expect(store.records()).toEqual([]);
    expect(await tool("theme_create").execute({ theme: { id: "half" } }, {})).toMatch(/- schema: /);
  });

  it("theme_create refuses a built-in or taken id", async () => {
    const { tool, service } = setup();
    expect(await tool("theme_create").execute({ theme: { ...ember(), id: "grid" } }, {})).toContain("- grid is a built-in theme. Pick another id.");
    await service.create(ember(), null);
    expect(await tool("theme_create").execute({ theme: ember() }, {})).toContain("- A theme ember exists. theme_update changes it");
  });

  it("theme_update merges a partial change and re-runs the checks; a failing change leaves the theme as it was", async () => {
    const { tool, service } = setup();
    await service.create(ember(), { name: "Home", botId: "home" });
    expect(await tool("theme_update").execute({ id: "ember", theme: { name: "Embers", scene: { uniforms: { u_bands: 6 } } } }, {})).toMatch(/^Updated ember \(Embers\)\./);
    expect(service.get("ember")).toMatchObject({ name: "Embers", scene: { uniforms: { u_bands: 6 }, still: 8 } });
    expect(service.listing("ember")!.creator).toEqual({ name: "Home", botId: "home" });
    const failed = await tool("theme_update").execute({ id: "ember", theme: { variants: { dark: { ink: "#0a0d14" } } } }, {});
    expect(failed).toMatch(/^Not saved\. Nothing changed\.\n- contrast:dark:/);
    expect(service.get("ember")!.variants.dark!.ink).toBe(THEME_TEMPLATE.variants.dark!.ink);
  });

  it("theme_update refuses to change a built-in and copies it under newId", async () => {
    const { tool, service } = setup();
    expect(await tool("theme_update").execute({ id: "grid", theme: { name: "Mine" } }, {})).toContain("- grid is a built-in theme and can't be changed. Pass newId");
    expect(service.get("grid")).toBe(GRID);
    expect(await tool("theme_update").execute({ id: "grid", newId: "grid-warm", theme: { name: "Grid Warm", palette: ["#050302", "#ffb35f", "#fff1dc", "#5ff6ff"] } }, { threadId: "home-thread" })).toMatch(/^Saved a copy as grid-warm \(Grid Warm\)/);
    expect(service.listing("grid-warm")).toMatchObject({ source: "stored", kind: "scene", creator: { name: "Home" } });
    expect(await tool("theme_update").execute({ id: "grid", newId: "nord", theme: {} }, {})).toContain("- A theme nord exists.");
    expect(await tool("theme_update").execute({ id: "nope", theme: {} }, {})).toContain("- No theme nope.");
  });

  it("theme_apply sets a theme on a Bot with its defaults, then just the sliders and switches given", async () => {
    const { tool, setAppearance, bots } = setup();
    expect(await tool("theme_apply").execute({ themeId: "nord", bot: "Home" }, {})).toBe("Home uses nord: intensity 0, glass 1, motion 0; effects on: workers, finished, needsYou, error.");
    expect(setAppearance).toHaveBeenLastCalledWith("home", { ...defaultAppearance(NORD), effects: defaultAppearance(GRID).effects });
    await tool("theme_apply").execute({ themeId: "grid" }, {});
    await tool("theme_apply").execute({ themeId: "grid", intensity: 0.3, effects: { workers: false } }, {});
    expect(bots[0]!.appearance).toEqual({ ...defaultAppearance(GRID), intensity: 0.3, effects: { ...defaultAppearance(GRID).effects, workers: false } });
    await tool("theme_apply").execute({ themeId: "grid", motion: 0.9 }, {});
    expect(bots[0]!.appearance).toMatchObject({ intensity: 0.3, motion: 0.9, effects: { workers: false } });
    expect(await tool("theme_apply").execute({ themeId: null }, {})).toBe("Chief of Staff has no theme now.");
    expect(bots[0]!.appearance).toBeNull();
    expect(await tool("theme_apply").execute({ themeId: "nope" }, {})).toBe("Not applied.\n- No theme nope. theme_list lists them.");
    expect(await tool("theme_apply").execute({ themeId: "grid", bot: "Lab" }, {})).toBe("No Bot Lab.");
  });

  it("theme_delete refuses a built-in and a theme in use, and deletes one no Bot uses", async () => {
    const { tool, service } = setup();
    await service.create(ember(), null);
    await tool("theme_apply").execute({ themeId: "ember", bot: "cos" }, {});
    expect(await tool("theme_delete").execute({ id: "grid" }, {})).toBe("Not deleted.\n- grid is a built-in theme and can't be deleted.");
    expect(await tool("theme_delete").execute({ id: "ember" }, {})).toBe("Not deleted.\n- ember is in use by Chief of Staff. Apply another theme to that Bot first (theme_apply).");
    expect(service.get("ember")).not.toBeNull();
    await tool("theme_apply").execute({ themeId: "nord", bot: "cos" }, {});
    expect(await tool("theme_delete").execute({ id: "ember" }, {})).toBe("Deleted ember.");
    expect(service.get("ember")).toBeNull();
    expect(await tool("theme_delete").execute({ id: "ember" }, {})).toBe("Not deleted.\n- No stored theme ember.");
  });
});

describe("a stored theme that a built-in took the id of", () => {
  it("hides the stored deep-sea behind the built-in Deep Sea, and a Bot set to deep-sea keeps its sliders on the built-in", async () => {
    const { store, service, bots, tool } = setup();
    const old = { ...structuredClone(THEME_TEMPLATE), id: "deep-sea", name: "Deep Sea", radius: 10 };
    store["db"].prepare("INSERT INTO studio_themes (id, name, json, creator, creator_bot_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run("deep-sea", "Deep Sea", JSON.stringify(old), "Chief of Staff", "cos", 1, 1);
    bots[0]!.appearance = { ...defaultAppearance(DEEP_SEA), intensity: 0.55 };
    expect(store.records()).toEqual([]);
    expect(store.get("deep-sea")).toBe(DEEP_SEA);
    const listed = service.list().filter((entry) => entry.id === "deep-sea");
    expect(listed).toMatchObject([{ source: "builtin", name: "Deep Sea", usedBy: [{ id: "cos", name: "Chief of Staff" }] }]);
    expect(bots[0]!.appearance).toMatchObject({ themeId: "deep-sea", intensity: 0.55 });
    expect(await tool("theme_create").execute({ theme: old }, {})).toMatch(/deep-sea is a built-in theme/);
  });
});

describe("checks with a GPU", () => {
  it("uses a window's measured frame time and backdrop in place of the static estimate, and saves on it", async () => {
    const measure = vi.fn(async () => [
      { id: "frame-time", pass: true, reason: "30 frames at 640×400: 1.2 ms each (budget 6 ms)" },
      { id: "backdrop", pass: true, reason: "Brightest blurred backdrop 0.1 (declared 0.12)" },
    ]);
    const { service } = setup({ measure });
    const report = await service.check(ember());
    expect(report.results.find((line) => line.id === "frame-time")!.reason).toBe("30 frames at 640×400: 1.2 ms each (budget 6 ms)");
    expect(report.results.filter((line) => line.id === "frame-time")).toHaveLength(1);
    const slow = vi.fn(async () => [{ id: "frame-time", pass: false, reason: "30 frames at 640×400: 14 ms each (budget 6 ms)" }]);
    const outcome = await setup({ measure: slow }).service.create(ember(), null);
    expect(outcome).toMatchObject({ ok: false, reasons: ["frame-time: 30 frames at 640×400: 14 ms each (budget 6 ms)"] });
  });

  it("falls back to the static estimate with no window, and skips the GPU for a classic theme", async () => {
    const measure = vi.fn(async () => null);
    const { service } = setup({ measure });
    expect((await service.check(ember())).results.find((line) => line.id === "frame-time")!.reason).toMatch(/^Static estimate, no WebGL here/);
    await service.check(NORD);
    expect(measure).toHaveBeenCalledTimes(1);
  });

  it("routes a measurement to the first window that claims it, and gives up when none does", async () => {
    vi.useFakeTimers();
    try {
      const published: unknown[] = [];
      let n = 0;
      const router = new ThemeGpuRouter((request) => published.push(request), { claimMs: 100, resultMs: 1000 }, () => `r${(n += 1)}`);
      const first = router.measure(GRID);
      const replied = handleGpuRequest(published[0], {
        canMeasure: () => true,
        claim: async (id) => router.claim(id),
        reply: async (id, results) => router.reply(id, results),
        measure: () => [{ id: "frame-time", pass: true, reason: "measured" }],
      });
      expect(await replied).toBe(true);
      expect(router.claim("r1")).toBe(false);
      expect(await first).toEqual([{ id: "frame-time", pass: true, reason: "measured" }]);
      const second = router.measure(GRID);
      expect(await handleGpuRequest(published[1], { canMeasure: () => false, claim: async () => true, reply: async () => true, measure: () => [] })).toBe(false);
      vi.advanceTimersByTime(150);
      expect(await second).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

it("merges objects, replaces arrays and values", () => {
  expect(mergeTheme({ a: { b: 1, c: [1, 2] }, d: 1 }, { a: { c: [3] }, d: null })).toEqual({ a: { b: 1, c: [3] }, d: null });
});
