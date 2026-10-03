import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { usageReportHtml } from "../seed.mjs";

export default ({ projectId, threadId, pluginRpc, seedPages }) => {
  const seedPost = async () => {
    const { post } = await pluginRpc("feed", "publish", { projectId, threadId, author: "Atlas", title: "Release notes ready for review", body: "The release checklist and notes are ready. Review the wording before sharing." });
    return { post, cleanup: () => pluginRpc("feed", "remove", { postId: post.id }) };
  };
  return [
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
      const dataDir = process.env.BB_DATA_DIR;
      const stageEnv = process.env.BB_CAPTURE_STAGE_ENV;
      if (!dataDir || !stageEnv) throw new Error("Explore transfers require BB_CAPTURE_STAGE_ENV for the isolated app");
      const manifest = await readFile(stageEnv, "utf8");
      if (!manifest.includes(`export BB_DATA_DIR=${JSON.stringify(dataDir)}`) || !manifest.includes(`export BB_SERVER_URL=${process.env.BB_SERVER_URL}`)) throw new Error("Explore fixture does not match the staged capture.env");
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
};
