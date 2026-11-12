import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { TriggerEngine } from "../triggers/engine";
import { EngineScheduler } from "../triggers/scheduler";

/** Studio's scheduler on a test database (migrations applied), with a clock a test can move. */
export function testScheduler(db: Database.Database, sdk: BbPluginApi["sdk"], clock?: { now: number }) {
  const warnings: string[] = [];
  const now = clock ? () => clock.now : undefined;
  const engine = new TriggerEngine(db, { ...(now ? { now } : {}), warn: (message) => warnings.push(message) });
  const scheduler = new EngineScheduler({ db, sdk, engine, ...(now ? { now } : {}) });
  return { engine, scheduler, warnings };
}
