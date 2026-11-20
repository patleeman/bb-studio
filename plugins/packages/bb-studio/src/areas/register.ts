import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { areasContract, areaUpdateInput } from "./contract";
import type { Areas } from "./areas";

export const AREA_TOOLS = ["area_update", "area_list", "area_get"];

const UPDATE = "Update an area card on the Tasks page: status (ok/flagged/broken), now (1–2 sentences), open items, covers, cadence. Pass name to create one; runners write status.json instead.";
const LIST = "List the areas the user's agents look after, problems first: each with its status, where it stands, open items, recent runs, and last and next run.";
const GET = "Read one area by id or name.";

export function registerAreas(bb: BbPluginApi, areas: Areas, guard: <T>(work: () => T) => T = (work) => work()) {
  bb.rpc.register(areasContract, {
    "areas.list": async () => guard(() => ({ areas: areas.list() })),
    "areas.get": async ({ id }) => guard(() => ({ area: areas.get(id) })),
    "areas.itemTask": async ({ area, title }) => guard(() => { const out = areas.itemTask(area, title); return { taskId: out.task.id, title: out.task.title, created: out.created }; }),
  });
  const tool = <S extends z.ZodTypeAny>(name: string, description: string, parameters: S, execute: (x: z.infer<S>, threadId: string | null) => unknown) => {
    bb.agents.registerTool({ name, description, parameters, execute: async (x: z.infer<S>, ctx: { threadId?: string | null }) => {
      try { return JSON.stringify(guard(() => execute(x, ctx?.threadId ?? null))); } catch (error) { return `Error: ${error instanceof Error ? error.message : String(error)}`; }
    } } as never);
  };
  tool("area_update", UPDATE, areaUpdateInput, (x, threadId) => areas.update(x, threadId));
  tool("area_list", LIST, z.object({}), () => ({ areas: areas.list() }));
  tool("area_get", GET, z.object({ id: z.string().trim().min(1).describe("The area's id or name") }), ({ id }) => ({ area: areas.get(id) }));
}
