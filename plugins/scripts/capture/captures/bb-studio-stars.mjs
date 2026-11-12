// Stars and the shared new tab library, from a staged BB seeded with
// interview-prep pages. BB_STARS_PHASE: "before" (main: the workbench's own
// list and the Studio table) or "after" (this branch: Starred in the sidebar,
// a page header's filled star, and one library in both places).
// Files: assets/stars/<phase>/<view>-<mode>.png; copy them out, they aren't
// README assets.
import { dismissProblems } from "./bb-studio-bot.mjs";

const PHASE = process.env.BB_STARS_PHASE === "before" ? "before" : "after";
const scheme = (client, value) => client.command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }] });
const PAGES = [
  // Starred, oldest star first, so the list reads Vocabulary, Round outline, System design library.
  { title: "System design library", icon: "📚", markdown: "Prompts in rank order, with the shape of a good answer for each.", starred: true },
  { title: "Round outline", icon: "🧭", markdown: "## The 50 minutes\n\n- 5 min: requirements\n- 10 min: API and data model\n- 25 min: design and deep dives\n- 10 min: trade-offs", starred: true },
  { title: "Vocabulary", icon: "🗣️", markdown: "Say the word, not the description: idempotency key, fan-out on write, backpressure.", starred: true },
  { title: "Mock: Online chess (Nov 9)", icon: "♟️", markdown: "Prompt: design online chess with matchmaking and live clocks." },
  { title: "Mock: Cloud devbox (Nov 9)", icon: "💻", markdown: "Prompt: design a cloud devbox developers use from the browser." },
  { title: "Breakdown: Web crawler", icon: "🕸️", markdown: "A model answer for \"design a web crawler\", in the order you'd say it." },
];

export default ({ projectId, threadId, pluginRpc, sleep }) => {
  let seeded = null;
  /** The pages, made once; this thread's are linked to it; stars only after (main has no stars). */
  const seed = async () => {
    if (seeded) return seeded;
    const { items } = await pluginRpc("studio", "overview", null);
    const pages = [];
    for (const page of PAGES) {
      const found = items.find((item) => item.kind === "page" && item.title === page.title && !item.archived);
      const id = found?.id ?? (await pluginRpc("studio", "pages.create", { projectId, parentId: null, title: page.title, icon: page.icon, markdown: page.markdown })).page.id;
      pages.push({ ...page, id });
    }
    const now = Date.now();
    for (const page of pages.slice(0, 4)) {
      await pluginRpc("studio", "linkItemThread", { thread: { threadId, ref: { pluginId: "pages", id: page.id }, role: "created", state: "idle", createdAt: now, updatedAt: now, metadata: {} } });
    }
    if (PHASE === "after") {
      await pluginRpc("studio", "starItems", { items: pages.map((page) => ({ pluginId: "pages", id: page.id })), starred: false });
      for (const page of pages.filter((each) => each.starred)) {
        await pluginRpc("studio", "starItems", { items: [{ pluginId: "pages", id: page.id }], starred: true });
        await sleep(20);
      }
    }
    seeded = pages;
    return pages;
  };

  const studio = async (client, mode, query) => {
    await scheme(client, mode);
    await client.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
    await seed();
    await client.navigate("/plugins/studio/studio");
    await client.evaluate(`localStorage.removeItem('bb:studio-workspace:v1'); localStorage.setItem('studio:query:all', ${JSON.stringify(query)})`);
    // The list's old address opens the workspace on its new tab page.
    await client.navigate("/plugins/studio/studio/collection");
    await client.waitForSelector('nav[aria-label="Studio"]', 30000);
    await dismissProblems(client);
    await client.waitForSelector('[data-studio-workspace] [role="row"][aria-label="Round outline"]', 30000);
  };

  /** A thread with its side panel's Studio tab on the list, the panel about `width` px wide. */
  const workbench = async (client, mode, width) => {
    await scheme(client, mode);
    // BB gives the side panel about half the window past the sidebar (measured: 0.5 × window − 161).
    await client.command("Emulation.setDeviceMetricsOverride", { width: Math.round(2 * (width + 161)), height: 900, deviceScaleFactor: 1.5, mobile: false });
    await seed();
    await client.navigate(`/projects/${projectId}/threads/${threadId}`);
    await sleep(1500);
    await dismissProblems(client);
    if (!(await client.evaluate(`!![...document.querySelectorAll("button")].find((each) => each.getAttribute("aria-label")?.startsWith("Hide right panel"))`))) {
      await client.evaluate(`[...document.querySelectorAll("button")].find((button) => button.getAttribute("aria-label")?.startsWith("Show right panel"))?.click()`);
      await sleep(800);
    }
    const hasStudio = await client.evaluate(`[...document.querySelectorAll('[role="tab"], button')].some((each) => each.textContent.trim() === "Studio")`);
    if (!hasStudio) {
      await client.evaluate(`(() => { const button = [...document.querySelectorAll("button")].find((each) => each.getAttribute("aria-label")?.startsWith("Open new tab")); if (!button) throw new Error("No new-tab button"); button.click(); })()`);
      await sleep(800);
    }
    await client.clickButtonText("Studio");
    for (let i = 0; i < 40; i++) {
      if (await client.hasText("Round outline", 300) && await client.hasText("Breakdown: Web crawler", 300)) break;
      if (await client.hasText("Back to Studio", 300)) await client.clickButtonText("Back to Studio");
      await sleep(500);
    }
    await client.waitForText("Breakdown: Web crawler", 10000);
    // Widen or narrow the panel by its separator, to `width`.
    const panel = await client.evaluate(`(() => {
      const anchor = [...document.querySelectorAll("*")].find((each) => each.textContent === "Breakdown: Web crawler" && !each.children.length);
      let el = anchor;
      while (el && el.getBoundingClientRect().width < 300) el = el.parentElement;
      while (el && el.parentElement && el.parentElement.getBoundingClientRect().left === el.getBoundingClientRect().left && el.parentElement.getBoundingClientRect().width < window.innerWidth - 100) el = el.parentElement;
      const rect = el.getBoundingClientRect();
      const handle = [...document.querySelectorAll('[role="separator"], [data-panel-resize-handle-id], [data-resize-handle]')].map((each) => ({ each, rect: each.getBoundingClientRect() })).filter(({ rect: r }) => r.height > 200 && Math.abs(r.left + r.width / 2 - rect.left) < 24)[0];
      if (handle) handle.each.setAttribute("data-capture-handle", "");
      return { left: rect.left, width: rect.width, handle: !!handle };
    })()`);
    if (panel.handle) {
      await client.dragBy("[data-capture-handle]", Math.round(panel.width - width), 0);
      await sleep(600);
    }
    const measured = await client.evaluate(`Math.round([...document.querySelectorAll("*")].find((each) => each.textContent === "Breakdown: Web crawler" && !each.children.length).closest('[data-library], .studio-root')?.getBoundingClientRect().width ?? 0)`);
    process.stdout.write(`  panel ${JSON.stringify(panel)} → library width ${measured}\n`);
    await sleep(800);
  };

  const shot = (id, file, setup) => ({
    id: `studio-stars-${id}`, packageDir: "bb-studio", fileName: `stars/${PHASE}/${file}.png`, showSidebar: true, privateSidebar: false,
    setup: async (client) => { try { await setup(client); } catch (error) { await scheme(client, ""); throw error; } },
  });

  const newTab = [
    ...["dark", "light"].map((mode) => shot(`studio-newtab-${mode}`, `studio-newtab-${mode}`, (client) => studio(client, mode, ""))),
    ...[["1000", "dark"], ["1000", "light"], ["600", "dark"]].map(([width, mode]) =>
      shot(`workbench-${width}-${mode}`, `workbench-${width}-${mode}`, (client) => workbench(client, mode, Number(width)))),
  ];
  if (PHASE === "before") return newTab;

  const stars = ["dark", "light"].flatMap((mode) => [
    shot(`sidebar-${mode}`, `starred-sidebar-${mode}`, async (client) => {
      await studio(client, mode, "");
      await client.evaluate(`document.querySelector('[data-testid="studio-sidebar-starred"]').click()`);
      await client.waitForSelector('[data-studio-workspace] [role="row"][aria-label="Vocabulary"]');
      const state = await client.evaluate(`({
        row: document.querySelector('[data-testid="studio-sidebar-starred"]')?.textContent,
        rows: [...document.querySelectorAll('[data-studio-workspace] [role="row"][aria-label]')].map((each) => each.getAttribute("aria-label")),
      })`);
      if (state.row !== "Starred3" || JSON.stringify(state.rows) !== JSON.stringify(["Vocabulary", "Round outline", "System design library"])) throw new Error(`Starred isn't the three pages, newest first: ${JSON.stringify(state)}`);
      await sleep(600);
    }),
    shot(`page-${mode}`, `starred-page-header-${mode}`, async (client) => {
      await studio(client, mode, "is:starred");
      await client.evaluate(`document.querySelector('[data-studio-workspace] [role="row"][aria-label="Round outline"]').click()`);
      await client.waitForSelector('[data-studio-star][aria-pressed="true"]', 30000);
      await client.waitForText("The 50 minutes", 30000);
      await sleep(800);
    }),
  ]);
  return [...stars, ...newTab];
};
