import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { explorePages, type CallRpc } from "./pages";
import { ExploreService, type ExploreDeps } from "./service";
import { ExploreStore, MIGRATIONS } from "./store";

const DOC = "## What it is\n\nThe job queue retries failed jobs with exponential backoff.\n\n## Why it matters\n\nBilling rides on it.";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

type FakePage = { id: string; projectId: string | null; parentId: string | null; title: string; icon: string; markdown: string; archived: boolean; snapshots: string[] };

/**
 * Pages and Studio over cross-plugin RPC: Pages keeps pages in memory, Studio
 * records tag calls, or fails like an uninstalled plugin.
 */
function fakePlugins(options: { studioMissing?: boolean } = {}) {
  const pages = new Map<string, FakePage>();
  const tagged: string[] = [];
  let made = 0;
  const view = (page: FakePage) => ({ id: page.id, archived: page.archived });
  const must = (id: string) => {
    const page = pages.get(id);
    if (!page) throw new Error("Page not found.");
    return page;
  };
  const pagesRpc = (method: string, input: Record<string, unknown>) => {
    switch (method) {
      case "create": {
        const id = `pg_${(made += 1).toString(16).padStart(12, "0")}`;
        const page = { id, projectId: input.projectId as string | null, parentId: input.parentId as string | null, title: input.title as string, icon: (input.icon as string) ?? "", markdown: input.markdown as string, archived: false, snapshots: [] };
        pages.set(id, page);
        return { page: view(page) };
      }
      case "get":
        return { page: pages.has(input.id as string) ? view(must(input.id as string)) : null };
      case "markdown":
        return { markdown: must(input.id as string).markdown };
      case "replaceMarkdown": {
        const page = must(input.id as string);
        page.snapshots.push(input.snapshotName as string);
        page.markdown = input.markdown as string;
        return { page: view(page) };
      }
      default:
        throw new Error(`Unexpected Pages method ${method}.`);
    }
  };
  const plugins: CallRpc = {
    async callRpc<T>({ pluginId, method, input }: { pluginId: string; method: string; input?: unknown }): Promise<T> {
      if (pluginId === "pages") return pagesRpc(method, input as Record<string, unknown>) as T;
      if (options.studioMissing) throw Object.assign(new Error("Plugin studio is not installed."), { status: 404 });
      expect(pluginId).toBe("studio");
      if (method === "createTag") return { tag: { id: "tag_explore" } } as T;
      const { items, add } = input as { items: { pluginId: string; id: string }[]; add: string[] };
      expect(add).toEqual(["tag_explore"]);
      tagged.push(...items.map((item) => `${item.pluginId}:${item.id}`));
      return { ok: true } as T;
    },
  };
  /** Deletes a page and the pages under it, like Pages does; returns their ids. */
  const remove = (id: string): string[] => {
    const ids = [id, ...[...pages.values()].filter((page) => page.parentId === id).flatMap((page) => remove(page.id))];
    for (const each of ids) pages.delete(each);
    return ids;
  };
  return { plugins, tagged, pages, page: must, list: () => [...pages.values()], remove };
}

/** Explore's store in memory, Pages and Studio faked over RPC, and the worker faked. */
function setup(options: { manual?: boolean; studioMissing?: boolean } = {}) {
  let at = 1_000;
  const now = () => (at += 1);
  const db = new Database(":memory:");
  for (const statement of MIGRATIONS) db.exec(statement);
  const store = new ExploreStore(db, now);
  const fake = fakePlugins({ studioMissing: options.studioMissing });
  const outputs: ReturnType<typeof deferred<string>>[] = [];
  const started: string[] = [];
  const disposed: string[] = [];
  const prompts: string[] = [];
  const changes: string[] = [];
  const warnings: string[] = [];
  const deps: ExploreDeps = {
    store,
    pages: explorePages(fake.plugins),
    now,
    log: { warn: (message) => warnings.push(message) },
    async collect() {
      return { projectId: "proj_1", hints: { read: ["src/queue.ts"], changed: [], searched: [] }, fork: { sourceSeqEnd: 42, environmentId: "env_1" } };
    },
    async startWorker(_explainer, prompt) {
      prompts.push(prompt);
      const id = `thr_worker_${started.length + 1}`;
      started.push(id);
      return id;
    },
    awaitWorker(_workerId, signal, progress) {
      progress({ fraction: 0.5, detail: "Investigating · looked at 3 files" });
      const output = deferred<string>();
      outputs.push(output);
      signal.addEventListener("abort", () => output.reject(new Error("aborted")), { once: true });
      if (!options.manual) output.resolve(`${DOC}\n\n::explore{items="🔗 Where retries are scheduled|🐛 Timeout is never reset"}`);
      return output.promise;
    },
    async disposeWorker(workerId) {
      disposed.push(workerId);
    },
    changed(explainer) {
      changes.push(explainer.id);
    },
  };
  const service = new ExploreService(deps);
  cleanups.push(() => service.dispose());
  return { db, store, service, pages: fake, studio: fake, outputs, started, disposed, prompts, changes, warnings, deps };
}

const click = { threadId: "thr_1", messageId: "msg_1", turnId: "turn_1", emoji: "🏗️", label: "How the job queue works" };

async function settle(service: ExploreService, id: string) {
  await flush();
  await service.settled(id);
}

describe("exploring a finding", () => {
  it("writes the page under the project's Explore page, tags it, and keeps the follow-ups", async () => {
    const { service, store, pages, studio, started, disposed } = setup();
    const { explainer, started: fresh } = service.explore(click);
    expect(fresh).toBe(true);
    expect(explainer.status).toBe("generating");
    await settle(service, explainer.id);

    const view = service.view(store.explainer(explainer.id)!);
    expect(view).toMatchObject({ status: "ready", projectId: "proj_1", href: `/plugins/pages/pages/${view.pageId}`, regeneratedAt: null, error: null, job: null });
    expect(view.generatedAt).toEqual(expect.any(Number));
    expect(view.followUps).toEqual([
      { emoji: "🔗", label: "Where retries are scheduled" },
      { emoji: "🐛", label: "Timeout is never reset" },
    ]);
    expect(pages.list().map((each) => each.title)).toEqual(["Explore", "How the job queue works"]);
    const parent = pages.page(store.parentPage("proj_1")!);
    expect(parent).toMatchObject({ title: "Explore", icon: "🧭", projectId: "proj_1", parentId: null });
    const saved = pages.page(view.pageId!);
    expect(saved).toMatchObject({ parentId: parent.id, projectId: "proj_1", icon: "🏗️" });
    expect(saved.markdown.startsWith(DOC)).toBe(true);
    expect(saved.markdown).not.toContain("::explore");
    expect(saved.markdown).toContain("(/threads/thr_1)");
    expect(studio.tagged).toEqual([`pages:${view.pageId}`]);
    expect(started).toEqual(["thr_worker_1"]);
    expect(disposed).toEqual(["thr_worker_1"]);
  });

  it("opens the existing explainer instead of writing another", async () => {
    const { service, started } = setup();
    const first = service.explore(click).explainer;
    await settle(service, first.id);
    const again = service.explore({ ...click, label: "  how the JOB queue works " });
    expect(again).toMatchObject({ started: false, explainer: { id: first.id } });
    expect(started).toHaveLength(1);
  });

  it("attaches a second click to the running job", async () => {
    const { service, store, outputs, started } = setup({ manual: true });
    const first = service.explore(click);
    await flush();
    await flush();
    const second = service.explore(click);
    expect(second).toMatchObject({ started: false, explainer: { id: first.explainer.id } });
    expect(service.view(store.explainer(first.explainer.id)!).job).toMatchObject({ status: "writing", detail: "Investigating · looked at 3 files" });
    expect(service.view(store.explainer(first.explainer.id)!).job!.progress).toBeGreaterThan(22);

    outputs[0]!.resolve(DOC);
    await settle(service, first.explainer.id);
    expect(started).toHaveLength(1);
    expect(store.explainer(first.explainer.id)!.status).toBe("ready");
  });

  it("keeps findings from different messages, labels and parents apart", async () => {
    const { service } = setup();
    const a = service.explore(click).explainer;
    const b = service.explore({ ...click, messageId: "msg_2" }).explainer;
    const c = service.explore({ ...click, label: "Something else" }).explainer;
    await settle(service, a.id);
    const d = service.explore({ ...click, parentId: a.id }).explainer;
    expect(new Set([a.id, b.id, c.id, d.id]).size).toBe(4);
    expect(d.parent_id).toBe(a.id);
  });

  it("gives a follow-up the parent page as context", async () => {
    const { service, prompts } = setup();
    const parent = service.explore(click).explainer;
    await settle(service, parent.id);
    const child = service.explore({ ...click, emoji: "🔗", label: "Where retries are scheduled", parentId: parent.id }).explainer;
    await settle(service, child.id);
    expect(prompts[1]).toContain("Earlier explainer: How the job queue works");
    expect(prompts[1]).toContain("The job queue retries failed jobs");
  });

  it("makes one Explore page per project, even for explainers started together", async () => {
    const { service, pages } = setup();
    const a = service.explore(click).explainer;
    const b = service.explore({ ...click, label: "Another finding" }).explainer;
    await settle(service, a.id);
    await settle(service, b.id);
    expect(pages.list().filter((each) => each.title === "Explore")).toHaveLength(1);
  });

  it("makes the Explore page again when it was deleted or archived", async () => {
    const { service, store, pages } = setup();
    const a = service.explore(click).explainer;
    await settle(service, a.id);
    const first = store.parentPage("proj_1")!;
    pages.page(first).archived = true;
    const b = service.explore({ ...click, label: "Another finding" }).explainer;
    await settle(service, b.id);
    const second = store.parentPage("proj_1")!;
    expect(second).not.toBe(first);
    expect(pages.page(store.explainer(b.id)!.page_id!).parentId).toBe(second);
    pages.remove(second);
    const c = service.explore({ ...click, label: "A third finding" }).explainer;
    await settle(service, c.id);
    expect(store.parentPage("proj_1")).not.toBe(second);
  });

  it("saves the page untagged when Studio isn't installed", async () => {
    const { service, store, warnings } = setup({ studioMissing: true });
    const { explainer } = service.explore(click);
    await settle(service, explainer.id);
    expect(store.explainer(explainer.id)).toMatchObject({ status: "ready", error: null });
    expect(warnings).toEqual([expect.stringMatching(/couldn't tag page pg_/)]);
  });

  it("fails the job with the error, and a click retries", async () => {
    const { service, store, deps } = setup();
    deps.collect = async () => {
      throw new Error("Thread not found.");
    };
    const { explainer } = service.explore(click);
    await settle(service, explainer.id);
    expect(service.view(store.explainer(explainer.id)!)).toMatchObject({ status: "error", error: "Thread not found.", pageId: null, job: { status: "error", error: "Thread not found." } });
    expect(service.explore(click).started).toBe(true);
  });

  it("fails the job when the worker writes nothing", async () => {
    const { service, store, outputs } = setup({ manual: true });
    const { explainer } = service.explore(click);
    await flush();
    await flush();
    outputs[0]!.resolve("ok");
    await settle(service, explainer.id);
    expect(store.explainer(explainer.id)).toMatchObject({ status: "error", error: expect.stringMatching(/empty/) });
  });
});

describe("regenerating", () => {
  it("replaces the page in place with a snapshot, and records when", async () => {
    const { service, store, pages, outputs } = setup({ manual: true });
    const { explainer } = service.explore(click);
    await flush();
    await flush();
    outputs[0]!.resolve(DOC);
    await settle(service, explainer.id);
    const pageId = store.explainer(explainer.id)!.page_id!;
    const generatedAt = store.explainer(explainer.id)!.generated_at;

    service.regenerate(explainer.id);
    expect(store.explainer(explainer.id)!.status).toBe("generating");
    await flush();
    await flush();
    outputs[1]!.resolve("## What it is\n\nA rewritten explainer about the job queue and its exponential backoff.");
    await settle(service, explainer.id);

    const row = store.explainer(explainer.id)!;
    expect(row).toMatchObject({ page_id: pageId, status: "ready", generated_at: generatedAt });
    expect(row.regenerated_at).toBeGreaterThan(generatedAt!);
    expect(pages.page(pageId).markdown).toMatch(/^## What it is\n\nA rewritten explainer/);
    expect(pages.page(pageId).snapshots).toEqual([expect.stringMatching(/^Before regenerate \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)]);
    expect(pages.list()).toHaveLength(2);
  });

  it("writes a new page when the old one was deleted in Pages", async () => {
    const { service, store, pages } = setup();
    const { explainer } = service.explore(click);
    await settle(service, explainer.id);
    const oldPage = store.explainer(explainer.id)!.page_id!;
    pages.remove(oldPage);
    service.regenerate(explainer.id);
    await settle(service, explainer.id);
    const row = store.explainer(explainer.id)!;
    expect(row.page_id).not.toBe(oldPage);
    expect(row.regenerated_at).toBeNull();
  });

  it("keeps the page readable when regenerating fails", async () => {
    const { service, store, outputs } = setup({ manual: true });
    const { explainer } = service.explore(click);
    await flush();
    await flush();
    outputs[0]!.resolve(DOC);
    await settle(service, explainer.id);
    service.regenerate(explainer.id);
    await flush();
    await flush();
    outputs[1]!.resolve("");
    await settle(service, explainer.id);
    const view = service.view(store.explainer(explainer.id)!);
    expect(view.status).toBe("ready");
    expect(view.pageId).not.toBeNull();
    expect(view.job).toMatchObject({ kind: "regenerate", status: "error" });
  });
});

describe("stopping and restarts", () => {
  it("stops the job and its worker, and the next click starts over", async () => {
    const { service, store, disposed } = setup({ manual: true });
    const { explainer } = service.explore(click);
    await flush();
    await flush();
    service.stop(explainer.id);
    await settle(service, explainer.id);
    expect(store.explainer(explainer.id)!.status).toBe("pending");
    expect(store.latestJob(explainer.id)!.status).toBe("cancelled");
    expect(disposed).toContain("thr_worker_1");
    expect(service.explore(click).started).toBe(true);
  });

  it("lets a click right after Stop start over while the stopped job unwinds", async () => {
    const { service, store } = setup({ manual: true });
    const { explainer } = service.explore(click);
    await flush();
    await flush();
    service.stop(explainer.id);
    // No settle: the stopped job is still in flight.
    const again = service.explore(click);
    expect(again.started).toBe(true);
    expect(store.activeJob(explainer.id)).toBeDefined();
    service.dispose();
  });

  it("marks jobs that were running at shutdown interrupted", async () => {
    const first = setup({ manual: true });
    const { explainer } = first.service.explore(click);
    await flush();
    await flush();
    expect(first.store.activeJob(explainer.id)).toBeDefined();

    // BB restarts: a new service over the same database.
    const service = new ExploreService({ ...first.deps });
    expect(service.recover()).toEqual([explainer.id]);
    // The worker it had started is stopped too.
    expect(first.disposed).toContain("thr_worker_1");
    expect(first.store.activeJob(explainer.id)).toBeUndefined();
    expect(first.store.latestJob(explainer.id)).toMatchObject({ status: "interrupted", error: "Interrupted by a restart." });
    expect(first.store.explainer(explainer.id)).toMatchObject({ status: "error", error: "Interrupted by a restart." });
    expect(service.view(first.store.explainer(explainer.id)!).job).toMatchObject({ status: "interrupted" });
    // A click retries.
    expect(service.explore(click).started).toBe(true);
    first.service.dispose();
  });

  it("leaves an explainer with a page ready when its regenerate was interrupted", async () => {
    const { service, store, outputs, deps } = setup({ manual: true });
    const { explainer } = service.explore(click);
    await flush();
    await flush();
    outputs[0]!.resolve(DOC);
    await settle(service, explainer.id);
    service.regenerate(explainer.id);
    await flush();
    new ExploreService({ ...deps }).recover();
    expect(store.explainer(explainer.id)).toMatchObject({ status: "ready", error: null });
    service.dispose();
  });
});

describe("deleted pages", () => {
  it("forgets an explainer's deleted page when it's opened, so the next click writes a new one", async () => {
    const { service, store, pages, changes } = setup();
    const { explainer } = service.explore(click);
    await settle(service, explainer.id);
    const pageId = store.explainer(explainer.id)!.page_id!;
    expect(await service.checkPage(explainer.id)).toMatchObject({ page_id: pageId, status: "ready" });
    // Deleting the Explore page deletes the explainers under it too.
    pages.remove(store.parentPage("proj_1")!);
    changes.length = 0;
    expect(await service.checkPage(explainer.id)).toMatchObject({ page_id: null, status: "pending", generated_at: null });
    expect(changes).toEqual([explainer.id]);
    const again = service.explore(click);
    expect(again).toMatchObject({ started: true, explainer: { id: explainer.id } });
    await settle(service, explainer.id);
    const row = store.explainer(explainer.id)!;
    expect(row.page_id).not.toBe(pageId);
    // The Explore page was made again for it.
    expect(pages.page(row.page_id!).parentId).toBe(store.parentPage("proj_1"));
  });

  it("keeps the page when Pages can't be reached", async () => {
    const { service, store, deps } = setup();
    const { explainer } = service.explore(click);
    await settle(service, explainer.id);
    const pageId = store.explainer(explainer.id)!.page_id!;
    deps.pages.get = async () => {
      throw new Error("Plugin pages is not installed.");
    };
    expect(await service.checkPage(explainer.id)).toMatchObject({ page_id: pageId, status: "ready" });
  });
});
