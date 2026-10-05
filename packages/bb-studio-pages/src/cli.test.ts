import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { pagesCli } from "./cli";
import { HUMAN_USER_ID } from "./constants";
import { PagesService } from "./service";
import { MIGRATIONS, PageStore } from "./store";

const services: PagesService[] = [];
afterEach(() => {
  for (const service of services.splice(0)) service.hub.disposeAll();
});

function setup() {
  const db = new Database(":memory:");
  for (const sql of MIGRATIONS) db.exec(sql);
  const store = new PageStore(db);
  const bb = { realtime: { publish: () => {} }, sdk: { threads: { get: async () => ({ title: "Fix bug" }) } } };
  const service = new PagesService(bb as never, store);
  services.push(service);
  const cli = pagesCli(service, () => {});
  const run = (...argv: string[]) => cli.run(argv, { projectId: "proj_1", threadId: null } as never) as Promise<{ exitCode: number; stdout?: string; stderr?: string }>;
  return { store, service, run, cli };
}

describe("bb pages", () => {
  it("show needs a page", async () => {
    const { service, run } = setup();
    service.createPage({ projectId: "proj_1", parentId: null, title: "", markdown: "Secret draft", actor: HUMAN_USER_ID });
    expect(await run("show")).toMatchObject({ exitCode: 1, stderr: expect.stringContaining("usage:") });
    expect(await run("show", "--ids")).toMatchObject({ exitCode: 1, stderr: expect.stringContaining("usage:") });
  });
});
