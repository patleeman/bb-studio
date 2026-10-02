// Explore and Studio Feed: what agents noticed along the way, kept for
// later. Every reply's findings are recorded when its thread goes idle. One
// can be saved to the Feed as its own post, which links the explainer page
// once it's written; and once a day the rest are posted as a digest, one per
// project. Feed is optional: without it, saving fails and there's no digest.
import { z } from "zod";
import { DIRECTIVE, parseExploreItems, type ExploreItem } from "./shared";
import type { ExploreStore, FindingRow } from "./store";

export const FEED_PLUGIN_ID = "feed";
/** Feed's prefix for a saved finding's story; its reader offers Explore on them. */
export const FEED_STORY_PREFIX = "explore-";
export const FEED_TOPIC = "Follow-ups";
/** The digest goes out at or after this local hour. */
export const DIGEST_HOUR = 18;
/** Findings older than this are left out of the digest. */
const DIGEST_WINDOW_MS = 7 * 86_400_000;
/** Findings listed in one digest post; the rest are counted. */
const DIGEST_MAX_ITEMS = 12;
const DIGEST_DAY_KEY = "digest_day";

const feedPost = z.object({ post: z.object({ id: z.string() }) });
const feedEdited = z.object({ post: z.object({ id: z.string() }).nullable() });

export interface FeedDeps {
  store: ExploreStore;
  callRpc<T>(pluginId: string, method: string, input: unknown, schema: z.ZodType<T>): Promise<T>;
  /** The explainer page for a finding, when one is written. */
  explainerPage(finding: FindingRow): { pageId: string; href: string } | null;
  projectName(projectId: string): Promise<string | null>;
  now?: () => number;
}

/** The findings line a reply ends with, if it has one. */
export function replyFindings(text: string | null | undefined): ExploreItem[] {
  if (!text) return [];
  const matches = [...text.matchAll(new RegExp(`::${DIRECTIVE}\\{items="([^"]*)"\\}`, "g"))];
  return parseExploreItems(matches.at(-1)?.[1]);
}

const threadLink = (finding: FindingRow) => `[${(finding.thread_title || "the thread").replace(/[[\]]/g, "")}](/threads/${finding.thread_id})`;

/** A saved finding's post body: where it came from, and its explainer when there is one. */
export function savedBody(finding: FindingRow, page: { href: string } | null): string {
  const lines = [`${finding.emoji} Noticed in ${threadLink(finding)}.`];
  if (page) lines.push("", `Explainer: [${finding.label.replace(/[[\]]/g, "")}](${page.href})`);
  return lines.join("\n");
}

/** One project's digest: suspicious things first, then the rest, oldest first within each. */
export function digestPost(findings: readonly FindingRow[], projectName: string | null): { title: string; body: string } {
  const ordered = [...findings].sort((a, b) => Number(b.emoji === "🐛") - Number(a.emoji === "🐛"));
  const shown = ordered.slice(0, DIGEST_MAX_ITEMS);
  const count = findings.length;
  const title = `Noticed along the way: ${count} ${count === 1 ? "finding" : "findings"}${projectName ? ` in ${projectName}` : ""}`;
  const lines = shown.map((finding) => `- ${finding.emoji} ${finding.label} · ${threadLink(finding)}`);
  if (count > shown.length) lines.push(`- …and ${count - shown.length} more`);
  lines.push("", "Open a thread to explore one, or save it to the feed from its reply.");
  return { title, body: lines.join("\n") };
}

/** "2026-10-01" in the server's local time. */
const localDay = (at: number) => {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

export function exploreFeed(deps: FeedDeps) {
  const now = deps.now ?? Date.now;
  const { store } = deps;

  /** Links a saved finding's post to its explainer, once it's written. */
  async function linkExplainer(finding: FindingRow): Promise<void> {
    const page = deps.explainerPage(finding);
    if (!finding.post_id || !page || finding.linked_page_id === page.pageId) return;
    const { post } = await deps.callRpc(FEED_PLUGIN_ID, "edit", { postId: finding.post_id, body: savedBody(finding, page) }, feedEdited);
    store.setFindingPost(finding.id, post ? finding.post_id : null, post ? page.pageId : null);
  }

  return {
    /** Posts a finding to the Feed, once; again if its post was removed. */
    async save(finding: FindingRow): Promise<string> {
      if (finding.post_id) {
        const { post } = await deps.callRpc(FEED_PLUGIN_ID, "post", { postId: finding.post_id }, feedEdited);
        if (post) return post.id;
      }
      const page = deps.explainerPage(finding);
      const { post } = await deps.callRpc(
        FEED_PLUGIN_ID,
        "publish",
        {
          title: finding.label,
          body: savedBody(finding, page),
          topic: FEED_TOPIC,
          story: `${FEED_STORY_PREFIX}${finding.id}`,
          author: "Explore",
          threadId: finding.thread_id,
          projectId: finding.project_id,
        },
        feedPost,
      );
      store.setFindingPost(finding.id, post.id, page?.pageId ?? null);
      return post.id;
    },

    linkExplainer,

    /** After an explainer changes: link it from the post its finding was saved as. */
    async explainerChanged(key: string): Promise<void> {
      const finding = store.findingByKey(key);
      if (finding?.post_id) await linkExplainer(finding);
    },

    /** Posts the day's digest, once a day after DIGEST_HOUR. Returns how many posts it made. */
    async digest(): Promise<number> {
      const at = now();
      const day = localDay(at);
      if (new Date(at).getHours() < DIGEST_HOUR || store.meta(DIGEST_DAY_KEY) === day) return 0;
      const findings = store.undigested(at - DIGEST_WINDOW_MS);
      const byProject = new Map<string, FindingRow[]>();
      for (const finding of findings) {
        const key = finding.project_id ?? "";
        byProject.set(key, [...(byProject.get(key) ?? []), finding]);
      }
      let posted = 0;
      // Tried once a day: what doesn't post (no Feed, say) waits for tomorrow's.
      try {
        for (const [projectId, group] of byProject) {
          const name = projectId ? await deps.projectName(projectId).catch(() => null) : null;
          const { title, body } = digestPost(group, name);
          await deps.callRpc(FEED_PLUGIN_ID, "publish", { title, body, topic: FEED_TOPIC, author: "Explore", projectId: projectId || null }, feedPost);
          store.markDigested(group.map((finding) => finding.id));
          posted += 1;
        }
      } finally {
        store.setMeta(DIGEST_DAY_KEY, day);
      }
      return posted;
    },
  };
}
