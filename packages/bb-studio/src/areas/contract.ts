import { z } from "zod";

export const AREA_OUTCOMES = ["ok", "flagged", "broken"] as const;
export const AREA_STATUSES = ["ok", "flagged", "broken", "unknown"] as const;
export type AreaOutcome = (typeof AREA_OUTCOMES)[number];
export type AreaStatus = (typeof AREA_STATUSES)[number];

export const KEEP_AREA_RUNS = 30;
export const MAX_OPEN_ITEMS = 30;
export const STATUS_FILE = "status.json";
export const LINE_MAX = 300;
export const NOW_MAX = 400;

export const openItem = z.object({
  title: z.string().min(1).max(200),
  since: z.string().max(40).nullable(),
  sinceAt: z.number().nullable(),
  needsUser: z.boolean(),
  taskId: z.string().nullable(),
});
export type OpenItem = z.infer<typeof openItem>;

export const areaRun = z.object({
  at: z.number(),
  outcome: z.enum(AREA_OUTCOMES),
  line: z.string().max(LINE_MAX),
  taskId: z.string().nullable(),
});
export type AreaRun = z.infer<typeof areaRun>;

export const areaOwner = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("runner"), runnerId: z.string().min(1), thread: z.string().nullable() }),
  z.object({ kind: z.literal("lead"), thread: z.string().min(1) }),
  z.object({ kind: z.literal("bot"), botId: z.string().min(1) }),
]);
export type AreaOwner = z.infer<typeof areaOwner>;

export const statedStatus = z.object({
  status: z.enum(AREA_OUTCOMES),
  at: z.number(),
  from: z.enum(["file", "agent", "notes"]),
});

export const area = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  covers: z.string().max(300),
  owner: areaOwner,
  ownerName: z.string().max(120),
  cadence: z.string().max(120).nullable(),
  stated: statedStatus.nullable(),
  now: z.string().max(NOW_MAX).nullable(),
  open: z.array(openItem).max(MAX_OPEN_ITEMS),
  runs: z.array(areaRun).max(KEEP_AREA_RUNS),
  links: z.array(z.string().min(1)).max(20),
  statusFile: z.string().nullable(),
  file: z.object({ readAt: z.number(), mtime: z.number().nullable(), error: z.string().nullable() }).nullable(),
  notesMtime: z.number().nullable().default(null),
  levels: z.record(z.string(), z.enum(["log", "tell", "urgent"])),
  archived: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Area = z.infer<typeof area>;

export const areaView = z.object({
  id: z.string(),
  name: z.string(),
  covers: z.string(),
  owner: areaOwner,
  ownerName: z.string(),
  cadence: z.string().nullable(),
  status: z.enum(AREA_STATUSES),
  reason: z.string().nullable().describe("Why the status isn't the latest stated one: a missed run or a broken run"),
  now: z.string().nullable(),
  open: z.array(openItem),
  runs: z.array(areaRun).describe("Newest first"),
  lastRun: z.number().nullable(),
  nextRun: z.number().nullable(),
  nextLabel: z.string().nullable().describe("The schedule the next run belongs to, when the area has more than one"),
  paused: z.boolean(),
  links: z.array(z.string()),
  statusFile: z.string().nullable(),
  fileError: z.string().nullable(),
  updatedAt: z.number(),
});
export type AreaView = z.infer<typeof areaView>;

const fileOpenItem = z.object({
  title: z.string().trim().min(1).max(200),
  since: z.string().trim().max(40).nullish(),
  needsUser: z.boolean().optional().default(false),
  taskId: z.string().regex(/^(task|loop|wc)_[A-Za-z0-9_-]+$/).nullish(),
}).strict();

export const statusFile = z.object({
  status: z.enum(AREA_OUTCOMES),
  now: z.string().trim().min(1).max(NOW_MAX),
  open: z.array(fileOpenItem).max(MAX_OPEN_ITEMS).default([]),
  updatedAt: z.string().refine((value) => Number.isFinite(Date.parse(value)), "updatedAt must be an ISO date and time"),
}).strict();
export type StatusFile = z.infer<typeof statusFile>;

export const areaUpdateInput = z.object({
  area: z.string().trim().min(1).max(80).optional().describe("The area's id or name; leave out for your own area"),
  name: z.string().trim().min(1).max(80).optional().describe("Its name; needed when you make a new area"),
  covers: z.string().trim().max(300).optional().describe("What the area covers, one short line"),
  status: z.enum(AREA_OUTCOMES).optional().describe("ok, flagged (something needs a look) or broken (it can't do its job)"),
  now: z.string().trim().max(NOW_MAX).optional().describe("Where it stands, in one or two sentences"),
  open: z.array(z.object({
    title: z.string().trim().min(1).max(200),
    since: z.string().trim().max(40).optional().describe("YYYY-MM-DD when it opened"),
    needsUser: z.boolean().optional().describe("True when the user must act on it"),
    taskId: z.string().trim().min(1).optional(),
  })).max(MAX_OPEN_ITEMS).optional().describe("Every open item; replaces the list"),
  cadence: z.string().trim().max(120).optional().describe("How often it is looked after, when no schedule says so"),
  links: z.array(z.string().trim().min(1)).max(20).optional().describe("Schedules whose runs belong to this area: a runner, check-in or watcher id or its recurring task id"),
  owner: z.string().regex(/^(me|cos|thread:.+)$/).optional().describe("\"me\" to take the area over; the Bot can give it to \"cos\" or \"thread:<id>\""),
  archive: z.boolean().optional().describe("True to take the area off the list"),
});
export type AreaUpdateInput = z.infer<typeof areaUpdateInput>;
