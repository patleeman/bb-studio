import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { usageReportHtml } from "../seed.mjs";

export default ({ projectId, threadId, pluginRpc, seedPages, bbCli, sleep }) => {
  const requireStage = async () => {
    const dataDir = process.env.BB_DATA_DIR;
    const stageEnv = process.env.BB_CAPTURE_STAGE_ENV;
    if (!dataDir || !stageEnv) throw new Error("Route variants require BB_CAPTURE_STAGE_ENV for the isolated app");
    const manifest = await readFile(stageEnv, "utf8");
    if (!manifest.includes(`export BB_DATA_DIR=${JSON.stringify(dataDir)}`) || !manifest.includes(`export BB_SERVER_URL=${process.env.BB_SERVER_URL}`)) throw new Error("Fixture does not match the staged capture.env");
    return dataDir;
  };
  const seedPost = async () => {
    const { post } = await pluginRpc("feed", "publish", { projectId, threadId, author: "Atlas", title: "Release notes ready for review", body: "The release checklist and notes are ready. Review the wording before sharing." });
    return { post, cleanup: () => pluginRpc("feed", "remove", { postId: post.id }) };
  };
  const fixtures = [
    { id: "studio", packageDir: "bb-studio", seed: async () => {
      const { cleanup } = await seedPages();
      return { path: "/plugins/studio/studio", ready: 'input[aria-label="Search and filter studio"]', draft: "Release notes", visibleText: "Release notes: October", cleanup };
    } },
    { id: "chat", packageDir: "bb-studio-chat", seed: async () => {
      const { page, cleanup } = await seedPages();
      return { path: `/plugins/studio-chat/chats/item/${encodeURIComponent(JSON.stringify({ pluginId: "pages", id: page.id }))}`, ready: '.studio-chat-composer [contenteditable="true"]', draft: "Keep this unsent item conversation", attachment: true, cleanup };
    } },
    { id: "feed", packageDir: "bb-studio-feed", seed: async () => {
      const { post, cleanup } = await seedPost();
      return { path: "/plugins/feed/feed", ready: 'form[aria-label="Filter feed"] input[type="search"]', draft: "Unapplied feed filter", visibleText: post.title, cleanup };
    } },
    { id: "feed-post", packageDir: "bb-studio-feed", seed: async () => {
      const { post, cleanup } = await seedPost();
      return { path: `/plugins/feed/feed/${post.id}`, ready: 'article h1', cleanup };
    } },
    { id: "feed-discussion", packageDir: "bb-studio-feed", seed: async () => {
      const { post, cleanup } = await seedPost();
      return { path: `/plugins/feed/feed/${post.id}/discussion`, ready: '.feed-discussion-composer [contenteditable="true"]', draft: "Keep this unsent Feed discussion", attachment: true, cleanup };
    } },
    { id: "explore", packageDir: "bb-studio-explore", seed: async () => {
      const dataDir = await requireStage();
      const require = createRequire(new URL("../../../packages/bb-studio-explore/package.json", import.meta.url));
      const Database = require("better-sqlite3");
      const db = new Database(join(dataDir, "plugins/explore/data.db"), { fileMustExist: true });
      const id = `expl_transfer_${randomUUID()}`, now = Date.now();
      let page;
      const cleanup = async () => {
        db.prepare("DELETE FROM explore_explainers WHERE id = ?").run(id);
        db.close();
        if (page) await pluginRpc("pages", "remove", { id: page.id });
      };
      try {
        ({ page } = await pluginRpc("pages", "create", { title: "Release usage explainer", projectId, parentId: null, markdown: `\`\`\`html\n${usageReportHtml({ draft: false })}\n\`\`\`` }));
        db.prepare("INSERT INTO explore_explainers (id,key,thread_id,message_id,emoji,label,project_id,status,page_id,generated_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
          .run(id, id, threadId, `msg_transfer_${id}`, "🏗️", page.title, projectId, "ready", page.id, now, now, now);
        const { explainers } = await pluginRpc("explore", "explainers", {});
        if (!explainers.some(explainer => explainer.id === id)) throw new Error("Explore RPC cannot read the transfer fixture");
        return { path: `/plugins/explore/explainers/${id}`, ready: `iframe[title="${page.title}"]`, embedded: true, cleanup };
      } catch (error) { await cleanup(); throw error; }
    } },
  ];
  const studio = fixtures.find(fixture => fixture.id === "studio");
  const explore = fixtures.find(fixture => fixture.id === "explore");
  return [...fixtures,
    { id: "studio-collection", packageDir: "bb-studio", seed: async () => ({ ...await studio.seed(), path: "/plugins/studio/studio/collection" }) },
    { id: "studio-activity", packageDir: "bb-studio", seed: async () => {
      await requireStage();
      const { dashboard } = await pluginRpc("studio", "home", { projectId, periodDays: 30 });
      const thread = dashboard.threads.find(thread => thread.id === threadId);
      if (!thread) throw new Error("Activity fixture cannot find its seeded, nonexecuting thread");
      return { path: "/plugins/studio/studio/activity", ready: "select", initialValue: "30", visibleText: thread.title, cleanup: async () => {} };
    } },
    { id: "studio-space", packageDir: "bb-studio", seed: async () => {
      await requireStage();
      let space;
      const cleanup = async () => {
        try { if (space) await pluginRpc("studio", "deleteSpace", { id: space.id }); }
        finally { await bbCli(["plugin", "enable", "pages", "--json"]); }
      };
      try {
        await bbCli(["plugin", "disable", "pages", "--json"]);
        ({ space } = await pluginRpc("studio", "createSpace", { name: "Release companion checks", description: "A staged fallback space with Pages disabled.", defaultProjectId: projectId }));
        return { path: `/plugins/studio/studio/space/${space.id}`, ready: 'button[aria-label="Space options"]', visibleText: space.name, cleanup };
      } catch (error) { await cleanup(); throw error; }
    } },
    { id: "chat-plain", packageDir: "bb-studio-chat", seed: async () => ({ path: "/plugins/studio-chat/chats", ready: '.studio-chat-composer [contenteditable="true"]', draft: "Keep this unsent general conversation", attachment: true, cleanup: async () => {} }) },
    { id: "chat-quote", packageDir: "bb-studio-chat", seed: async client => {
      const { page, cleanup } = await seedPages();
      let path;
      try {
        await client.navigate(`/plugins/pages/pages/${page.id}`);
        await client.waitForSelector('.pages-editor .ProseMirror');
        const quote = { text: "Ship offline sync to beta teams", note: "Clarify the rollout timing", where: "Launch checklist", image: null };
        await client.evaluate(`window.__bbStudioItemChat_v1.host.send(${JSON.stringify({ pluginId: "pages", id: page.id })}, ${JSON.stringify(quote)})`, true);
        await client.waitForSelector('.studio-chat-composer [contenteditable="true"]');
        path = await client.evaluate(`JSON.parse(sessionStorage.getItem('bb-studio-float:windows')).tabs.find(tab => tab.target.kind === 'path' && tab.target.path.startsWith('/plugins/studio-chat/chats/quote/'))?.target.path`);
        if (!path) throw new Error("The real quote action did not create a saved quote composer");
        await client.evaluate(`sessionStorage.removeItem('bb-studio-float:windows'); sessionStorage.removeItem('bb:companion-views:v1')`);
        await client.command('Page.navigate', { url: 'about:blank' });
        await sleep(400);
        return { path, ready: '.studio-chat-composer [contenteditable="true"]', appendDraft: " Also check the retry timing.", attachment: true, quoteText: quote.text, cleanup,
          beforeUnload: async () => client.evaluate(`new Promise((resolve, reject) => {
            const request = indexedDB.open('bb-studio-chat:drafts', 1);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const db = request.result, transaction = db.transaction('quotes', 'readwrite');
              transaction.objectStore('quotes').delete(${JSON.stringify(path.split('/').at(-1))});
              transaction.oncomplete = () => { db.close(); resolve(true); };
              transaction.onerror = () => { db.close(); reject(transaction.error); };
            };
          })`, true),
        };
      } catch (error) { await cleanup(); throw error; }
    } },
    ...["list", "thread"].map(kind => ({ id: `explore-${kind}`, packageDir: "bb-studio-explore", seed: async () => {
      const seeded = await explore.seed();
      const id = seeded.path.split('/').at(-1);
      return { ...seeded, path: `/plugins/explore/explainers${kind === "thread" ? `/thread/${threadId}` : ""}`, ready: `button[data-explainer-open="${id}"]`, embedded: false, visibleText: "Release usage explainer" };
    } })),
  ];
};
