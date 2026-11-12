import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { MIGRATIONS } from "../migrations";
import { PRESENCE_TOOLS, presenceTools, type PresenceTool } from "./agent-tools";
import { handleCheckRequest } from "./check-bridge";
import { PresenceCheckRouter } from "./check-router";
import { evaluateMeasurement, type CheckLine } from "./checks";
import { parsePresenceCli, runPresenceCli } from "./cli";
import { presenceAskText } from "./contract";
import { defaultPresence, type Presence, type PresencePackage } from "./schema";
import { PresenceService, type PresenceBot } from "./service";
import { PresenceStore } from "./store";
import { PRESENCE_TEMPLATE_CODE } from "./template";

const PASSED: CheckLine[] = [{ id: "runs", pass: true, reason: "Starts and draws in the sandbox" }, { id: "states", pass: true, reason: "All differ" }];
const crane = (over: Record<string, unknown> = {}) => ({ id: "crane", name: "Crane", description: "A paper crane.", code: PRESENCE_TEMPLATE_CODE, ...over });

function setup(measure: ((presence: PresencePackage) => Promise<CheckLine[] | null>) | null = async () => PASSED) {
  const db = new Database(":memory:");
  for (const migration of MIGRATIONS) db.exec(migration);
  let at = 1000;
  const store = new PresenceStore(db, () => (at += 1));
  const bots: PresenceBot[] = [
    { id: "cos", name: "Chief of Staff", presence: defaultPresence("cos", true) },
    { id: "home", name: "Home", presence: { form: "orb", color: { source: "custom", hex: "#ffaa00" }, motion: 0.5 } },
  ];
  const setPresence = vi.fn(async (botId: string, presence: Presence) => { bots.find((bot) => bot.id === botId)!.presence = presence; });
  const service = new PresenceService({ store, bots: () => bots, setPresence, ...(measure ? { measure } : {}) });
  const tools = presenceTools({
    service,
    creator: async (threadId) => (threadId === "home-thread" ? { name: "Home", botId: "home" } : { name: "Chief of Staff", botId: "cos" }),
    resolveBot: async (ref) => {
      if (!ref) return { id: "cos", name: "Chief of Staff" };
      const bot = bots.find((each) => each.id === ref || each.name.toLowerCase() === ref.toLowerCase());
      return bot ? { id: bot.id, name: bot.name } : `No Bot ${ref}.`;
    },
  });
  const tool = (name: (typeof PRESENCE_TOOLS)[number]) => tools.find((each) => each.name === name)! as PresenceTool & { execute(input: unknown, ctx: { threadId?: string }): Promise<string> };
  const files = new Map<string, string>();
  const cli = (...argv: string[]) => runPresenceCli(argv, {
    service,
    readFile: async (path) => { const text = files.get(path); if (text === undefined) throw new Error("ENOENT"); return text; },
    resolveBot: async (ref) => { const bot = ref ? bots.find((each) => each.id === ref || each.name === ref) : bots[0]; return bot ? { id: bot.id, name: bot.name } : `No Bot ${ref}.`; },
  });
  return { store, service, bots, setPresence, tool, tools, cli, files };
}

describe("the presence service", () => {
  it("lists the eight built-in forms, then stored presences with who made them and who uses them", async () => {
    const { service } = setup();
    expect(service.list().map((entry) => entry.id)).toEqual(["orb", "tesseract", "knot", "swarm", "mobius", "poly", "attractor", "klein"]);
    expect(service.list().find((entry) => entry.id === "orb")!.usedBy).toEqual([{ id: "home", name: "Home" }]);
    await service.create(crane(), { name: "Home", botId: "home" });
    const stored = service.entries().at(-1)!;
    expect(stored).toMatchObject({ id: "crane", source: "stored", creator: { name: "Home", botId: "home" }, usedBy: [], code: PRESENCE_TEMPLATE_CODE });
    expect(service.entries().find((entry) => entry.id === "orb")!.code).toBeNull();
  });

  it("saves only when the source checks and the sandbox run both pass", async () => {
    const measure = vi.fn(async (): Promise<CheckLine[] | null> => PASSED);
    const { service, store } = setup(measure);
    const hostile = await service.create(crane({ code: `function draw(ctx) { fetch("https://example.com"); }` }), null);
    expect(hostile.ok).toBe(false);
    expect(!hostile.ok && hostile.reasons.join(" ")).toContain("network");
    expect(measure).not.toHaveBeenCalled();
    measure.mockResolvedValueOnce([{ id: "runs", pass: false, reason: "A frame took longer than 120 ms." }]);
    const slow = await service.create(crane(), null);
    expect(slow.ok).toBe(false);
    expect(!slow.ok && slow.reasons).toEqual(["runs: A frame took longer than 120 ms."]);
    expect(store.has("crane")).toBe(false);
    const saved = await service.create(crane(), null);
    expect(saved.ok).toBe(true);
    expect(saved.ok && saved.report.results.map((line) => line.id)).toEqual(["schema", "size", "api", "network", "isolation", "runs", "states"]);
    expect(store.get("crane")!.presence.code).toBe(PRESENCE_TEMPLATE_CODE);
  });

  it("saves nothing when no window can run the sandbox", async () => {
    for (const measure of [null, async () => null, async () => { throw new Error("offline"); }]) {
      const { service, store } = setup(measure);
      const outcome = await service.create(crane(), null);
      expect(outcome.ok).toBe(false);
      expect(!outcome.ok && outcome.reasons[0]).toContain("No BB Studio window answered");
      expect(store.has("crane")).toBe(false);
    }
  });

  it("refuses a built-in id, a taken id, and updates to built-in forms", async () => {
    const { service } = setup();
    expect(await service.create(crane({ id: "tesseract" }), null)).toMatchObject({ ok: false, reasons: ["tesseract is a built-in form. Pick another id."] });
    await service.create(crane(), null);
    expect((await service.create(crane(), null)).ok).toBe(false);
    expect(await service.update("orb", { name: "Ball" }, { creator: null })).toMatchObject({ ok: false });
    expect(await service.update("nope", { name: "x" }, { creator: null })).toMatchObject({ ok: false, reasons: ["No presence nope."] });
  });

  it("updates fields with the checks run again, and copies under a new id", async () => {
    const { service, store } = setup();
    await service.create(crane(), { name: "Home", botId: "home" });
    const renamed = await service.update("crane", { name: "Paper crane" }, { creator: null });
    expect(renamed.ok && renamed.presence).toMatchObject({ id: "crane", name: "Paper crane", code: PRESENCE_TEMPLATE_CODE });
    expect(store.get("crane")!.creator).toEqual({ name: "Home", botId: "home" });
    const broken = await service.update("crane", { code: "function draw() { document.title = 1; }" }, { creator: null });
    expect(broken.ok).toBe(false);
    expect(store.get("crane")!.presence.code).toBe(PRESENCE_TEMPLATE_CODE);
    const copy = await service.update("crane", { name: "Swan" }, { newId: "swan", creator: { name: "CLI", botId: null } });
    expect(copy.ok && copy.presence.id).toBe("swan");
    expect(store.get("swan")!.creator).toEqual({ name: "CLI", botId: null });
    expect((await service.update("crane", {}, { newId: "orb", creator: null })).ok).toBe(false);
    expect((await service.update("crane", { id: "other" }, { creator: null })).ok).toBe(false);
  });

  it("applies a form, color or motion to a Bot and keeps what was left out", async () => {
    const { service, bots, setPresence } = setup();
    expect(await service.apply({ botId: "home", form: "klein" })).toEqual({ ok: true, bot: { id: "home", name: "Home" }, presence: { form: "klein", color: { source: "custom", hex: "#ffaa00" }, motion: 0.5 } });
    expect(await service.apply({ botId: "home", color: { source: "theme" }, motion: 2 })).toMatchObject({ ok: true, presence: { form: "klein", color: { source: "theme" }, motion: 2 } });
    expect(bots[1]!.presence.form).toBe("klein");
    expect(await service.apply({ botId: "home", form: "nope" })).toEqual({ ok: false, reasons: ["No presence nope. presence_list lists them."] });
    expect(await service.apply({ botId: "ghost", form: "orb" })).toEqual({ ok: false, reasons: ["No Bot ghost."] });
    expect((await service.apply({ botId: "home", motion: 5 })).ok).toBe(false);
    expect(setPresence).toHaveBeenCalledTimes(2);
  });

  it("deletes a stored presence no Bot uses", async () => {
    const { service } = setup();
    await service.create(crane(), null);
    await service.apply({ botId: "cos", form: "crane" });
    expect(service.remove("crane")).toEqual({ ok: false, reasons: ["crane is in use by Chief of Staff. Apply another presence to that Bot first (presence_apply)."] });
    await service.apply({ botId: "cos", form: "tesseract" });
    expect(service.remove("crane")).toEqual({ ok: true, id: "crane" });
    expect(service.remove("crane").ok).toBe(false);
    expect(service.remove("orb")).toEqual({ ok: false, reasons: ["orb is a built-in form and can't be deleted."] });
  });
});

describe("the presence tools", () => {
  it("are presence_list, presence_create, presence_update, presence_apply and presence_delete", () => {
    const { tools } = setup();
    expect(tools.map((tool) => tool.name)).toEqual([...PRESENCE_TOOLS]);
    const create = tools.find((tool) => tool.name === "presence_create")!;
    expect(create.description).toContain("function draw(ctx, t, state, palette, size)");
    expect(create.description).toContain('"id": "three-rings"');
  });

  it("create from a module, credit the Bot whose thread made it, then apply and delete", async () => {
    const { tool, service, bots } = setup();
    const made = await tool("presence_create").execute({ id: "crane", name: "Crane", code: PRESENCE_TEMPLATE_CODE }, { threadId: "home-thread" });
    expect(made).toContain("Saved crane (Crane). presence_apply puts it on a Bot.");
    expect(made).toContain("pass  runs");
    expect(service.entries().at(-1)).toMatchObject({ id: "crane", description: "", creator: { name: "Home", botId: "home" } });
    expect(await tool("presence_list").execute({}, {})).toContain("crane\tCrane (stored) · made by Home");
    expect(JSON.parse(await tool("presence_list").execute({ id: "crane" }, {}))).toMatchObject({ id: "crane", code: PRESENCE_TEMPLATE_CODE });
    expect(await tool("presence_list").execute({ id: "orb" }, {})).toContain("orb\tOrb (builtin)");
    expect(await tool("presence_apply").execute({ form: "crane", bot: "Home", color: "#00AAFF", motion: 1.5 }, {})).toBe("Home shows crane, color #00aaff, motion 1.5.");
    expect(bots[1]!.presence).toEqual({ form: "crane", color: { source: "custom", hex: "#00aaff" }, motion: 1.5 });
    expect(await tool("presence_apply").execute({ color: "theme" }, {})).toBe("Chief of Staff shows tesseract, color from theme, motion 1.");
    expect(await tool("presence_apply").execute({ form: "orb", bot: "Nobody" }, {})).toBe("No Bot Nobody.");
    expect(await tool("presence_delete").execute({ id: "crane" }, {})).toContain("in use by Home");
    await tool("presence_apply").execute({ form: "orb", bot: "home" }, {});
    expect(await tool("presence_delete").execute({ id: "crane" }, {})).toBe("Deleted crane.");
  });

  it("say why nothing was saved", async () => {
    const { tool, store } = setup();
    const text = await tool("presence_create").execute({ id: "leak", name: "Leak", code: `function draw() { new WebSocket("wss://example.com"); parent.postMessage(1, "*"); }` }, {});
    expect(text).toContain("Not saved. Nothing changed.");
    expect(text).toContain("FAIL  network");
    expect(text).toContain("FAIL  isolation");
    expect(store.has("leak")).toBe(false);
    expect(await tool("presence_update").execute({ id: "tesseract", name: "Cube" }, {})).toContain("built-in form");
  });

  it("the picker's Create field asks the Bot to call presence_create", () => {
    expect(presenceAskText("  a lava lamp ")).toBe("Make a presence (my living icon) with presence_create from this description, then put it on with presence_apply: a lava lamp");
  });
});

describe("bb studio presence", () => {
  it("parses its commands and says the usage otherwise", () => {
    expect(parsePresenceCli(["list", "--json"])).toEqual({ ok: true, value: { command: "list", json: true } });
    expect(parsePresenceCli(["create", "--file", "p.json", "--code", "draw.js"])).toEqual({ ok: true, value: { command: "create", file: "p.json", code: "draw.js" } });
    expect(parsePresenceCli(["apply", "crane", "--bot", "Home", "--color", "#00aaff", "--motion", "0.5"])).toEqual({ ok: true, value: { command: "apply", form: "crane", bot: "Home", color: "#00aaff", motion: 0.5 } });
    expect(parsePresenceCli(["update", "crane", "--code", "draw.js", "--new-id", "swan"])).toEqual({ ok: true, value: { command: "update", id: "crane", file: null, code: "draw.js", newId: "swan" } });
    for (const bad of [[], ["fly"], ["create"], ["update", "crane"], ["apply"], ["apply", "orb", "--motion", "3"], ["apply", "orb", "--color", "red"], ["show"], ["list", "--nope"]]) expect(parsePresenceCli(bad).ok, bad.join(" ")).toBe(false);
  });

  it("checks, creates from a JSON file with the code in its own file, shows, applies and deletes", async () => {
    const { cli, files, bots } = setup();
    files.set("p.json", JSON.stringify({ id: "crane", name: "Crane" }));
    files.set("draw.js", PRESENCE_TEMPLATE_CODE);
    expect(await cli("check", "--file", "p.json")).toMatchObject({ exitCode: 1 });
    const checked = await cli("check", "--file", "p.json", "--code", "draw.js", "--json");
    expect(checked.exitCode).toBe(0);
    expect(JSON.parse(checked.stdout!).pass).toBe(true);
    expect((await cli("list")).stdout).not.toContain("crane");
    const made = await cli("create", "--file", "p.json", "--code", "draw.js");
    expect(made).toMatchObject({ exitCode: 0 });
    expect(made.stdout).toContain("Saved crane (Crane).");
    expect((await cli("list")).stdout).toContain("crane\tCrane (stored) · made by CLI");
    expect((await cli("show", "crane")).stdout).toContain('"code"');
    expect((await cli("show", "orb")).stdout).toBe("orb\tOrb (builtin) · Three drifting lobes in a glass sphere. · used by Home\n");
    expect(await cli("apply", "crane", "--bot", "home", "--motion", "2")).toEqual({ exitCode: 0, stdout: "Home: crane, color #ffaa00, motion 2\n" });
    expect(bots[1]!.presence.form).toBe("crane");
    expect((await cli("delete", "crane")).exitCode).toBe(1);
    await cli("apply", "orb", "--bot", "home");
    expect(await cli("delete", "crane")).toEqual({ exitCode: 0, stdout: "Deleted crane.\n" });
    expect((await cli("template")).stdout).toContain('"three-rings"');
    expect((await cli("template", "--guide")).stdout).toContain("function draw(ctx, t, state, palette, size)");
  });

  it("reports unreadable files, bad JSON and failed checks with exit code 1", async () => {
    const { cli, files } = setup();
    expect((await cli("create", "--file", "missing.json")).stderr).toContain("Couldn't read missing.json");
    files.set("bad.json", "{");
    expect((await cli("create", "--file", "bad.json")).stderr).toContain("isn't JSON");
    files.set("leak.json", JSON.stringify({ id: "leak", name: "Leak", code: `function draw() { importScripts("x"); }` }));
    const refused = await cli("create", "--file", "leak.json");
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain("network: Refers to importScripts");
    expect((await cli("fly")).stderr).toContain("usage: bb studio presence");
  });
});

describe("running the checks in an open window", () => {
  const presence = crane({ description: "" }) as PresencePackage;

  it("the first window to claim a request runs it and answers", async () => {
    const published: unknown[] = [];
    const router = new PresenceCheckRouter((request) => published.push(request), { claimMs: 50, resultMs: 50 }, () => "req-1");
    const pending = router.measure(presence);
    expect(published).toEqual([{ requestId: "req-1", presence }]);
    const measure = vi.fn(async () => PASSED);
    const deps = { canMeasure: () => true, claim: async (id: string) => router.claim(id), reply: async (id: string, results: CheckLine[]) => router.reply(id, results), measure };
    expect(await handleCheckRequest(published[0], deps)).toBe(true);
    expect(await handleCheckRequest(published[0], deps)).toBe(false);
    expect(measure).toHaveBeenCalledTimes(1);
    expect(measure).toHaveBeenCalledWith(PRESENCE_TEMPLATE_CODE);
    expect(await pending).toEqual(PASSED);
  });

  it("answers nothing when no window claims it, a hidden window stays out, and a crash is a failed run", async () => {
    const router = new PresenceCheckRouter(() => {}, { claimMs: 5, resultMs: 5 }, () => "req-2");
    expect(await router.measure(presence)).toBeNull();
    expect(router.claim("req-2")).toBe(false);
    const claim = vi.fn(async () => true);
    expect(await handleCheckRequest({ requestId: "r", presence }, { canMeasure: () => false, claim, reply: async () => {}, measure: async () => PASSED })).toBe(false);
    expect(await handleCheckRequest({ requestId: "r", presence: { id: "x" } }, { canMeasure: () => true, claim, reply: async () => {}, measure: async () => PASSED })).toBe(false);
    expect(claim).not.toHaveBeenCalled();
    const reply = vi.fn(async () => {});
    await handleCheckRequest({ requestId: "r", presence }, { canMeasure: () => true, claim, reply, measure: async () => { throw new Error("worker crashed"); } });
    expect(reply).toHaveBeenCalledWith("r", [{ id: "runs", pass: false, reason: "worker crashed" }]);
    expect(evaluateMeasurement({ failure: "worker crashed", samples: [], light: [], repeat: null, later: null, frameMs: [] })[0]!.pass).toBe(false);
  });
});
