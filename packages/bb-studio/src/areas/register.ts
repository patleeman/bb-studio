import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { areaUpdateInput } from "./contract";
import type { Areas } from "./areas";
import { callText, clipLine, nextLine, pageByKey, staleCursor } from "../paging";
import { statusRank } from "./derive";

export const AREA_TOOLS = ["area_update", "area_list", "area_get"];

const UPDATE = "Update an area: status (ok/flagged/broken), now (1–2 sentences), open items, covers, cadence. Pass name to create one; runners write status.json instead.";
const LIST = "List the areas the user's agents look after, problems first: one short line each (status, where it stands, open items, last and next run), in parts. Read one in full with area (op: get).";
const GET = "Read one area by id or name: where it stands, its open items and its 10 newest runs.";
/** Runs area_get shows, newest first. */
const GET_RUNS = 10;

export function registerAreas(bb: BbPluginApi, areas: Areas, guard: <T>(work: () => T) => T = (work) => work()) {
  const tool = <S extends z.ZodTypeAny>(name: string, description: string, parameters: S, execute: (x: z.infer<S>, threadId: string | null) => unknown) => {
    bb.agents.registerTool({ name, description, parameters, execute: async (x: z.infer<S>, ctx: { threadId?: string | null }) => {
      try { return JSON.stringify(guard(() => execute(x, ctx?.threadId ?? null))); } catch (error) { return `Error: ${error instanceof Error ? error.message : String(error)}`; }
    } } as never);
  };
  tool("area_update", UPDATE, areaUpdateInput, (x, threadId) => areas.update(x, threadId));
  const time = (at: number | null) => (at ? new Date(at).toISOString().slice(0, 16).replace("T", " ") : null);
  bb.agents.registerTool({
    name: "area_list", description: LIST,
    parameters: z.object({ after: z.string().min(1).max(512).optional().describe("The cursor the last part's Next names") }),
    execute: async ({ after }: { after?: string }) => {
      try {
        const list = guard(() => areas.list());
        if (!list.length) return "No areas yet.";
        const rows = list.map((each) => ({ id: each.id, line: JSON.stringify({ id: each.id, name: each.name, status: each.status, ...(each.reason ? { reason: clipLine(each.reason, 120) } : {}), ...(each.now ? { now: clipLine(each.now, 160) } : {}), open: each.open.length, lastRun: time(each.lastRun), nextRun: time(each.nextRun), ...(each.paused ? { paused: true } : {}) }) }));
        // By keyset on (problems first, name, id): an area whose status changes moves, but never makes another repeat.
        const rank = new Map(list.map((each) => [each.id, [statusRank(each.status), each.name.toLowerCase(), each.id] as (string | number)[]]));
        const part = pageByKey(rows, (each) => rank.get(each.id)!, (each) => each.line.length, { after });
        if (part.missing) return staleCursor("That cursor", callText("area_list", {}));
        const next = nextLine(part, (last) => callText("area_list", { after: last }), "areas");
        return [`${list.length} area${list.length === 1 ? "" : "s"}, problems first. One in full: ${callText("area_get", { id: "<id>" })}.`, ...(next ? [next] : []), ...part.items.map((each) => each.line)].join("\n");
      } catch (error) { return `Error: ${error instanceof Error ? error.message : String(error)}`; }
    },
  } as never);
  tool("area_get", GET, z.object({ id: z.string().trim().min(1).describe("The area's id or name") }), ({ id }) => {
    const found = areas.get(id);
    if (!found) return { area: found };
    const { runs, ...rest } = found as typeof found & { runs: unknown[] };
    return { area: { ...rest, runs: runs.slice(0, GET_RUNS), ...(runs.length > GET_RUNS ? { olderRuns: runs.length - GET_RUNS } : {}) } };
  });
}
