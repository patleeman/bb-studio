// bb-studio-design — server entry.
//
// A design is a set of rounds; each round holds a few options; each option is
// one self-contained HTML screen. Agents write screens with the design_* tools,
// the canvas shows them newest round first, and Studio lists designs in its
// collection (src/server/studio.ts).
import { studioSchemas } from "@bb-studio/kit/contract";
import { createChangeBus, defineItemMention, serveBytes, studioServices } from "@bb-studio/kit/server";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { DESIGN_UPDATE_TYPE, PLUGIN_ID, REALTIME_CHANNEL, SCREEN_ID, VIEWPORT_NAMES, designHref, parseSteps, QUESTIONS_RENDERER, screenUrl, type DesignView } from "./src/shared";
import { DesignStore, MIGRATIONS, displayName, type Writer } from "./src/server/store";
import { registerStudio, screenText } from "./src/server/studio";
import { withScreenScript } from "./src/server/screen-script";
import { VERDICT_DONE, parseVerdict, reviewTargets, reviewerPrompt, type ReviewState } from "./src/server/review";
import type { CommentRow, DesignRow } from "./src/server/store";
import { summarizeAnswers, type Answers, type QuestionForm } from "./src/questions";

const optionSchema = z.object({ label: z.string().trim().min(1).max(120), description: z.string().max(240).optional() });
const questionSchema = z.discriminatedUnion("kind", [
  z.object({ id: z.string().min(1).max(40), kind: z.enum(["choice", "multi"]), question: z.string().trim().min(1).max(200), help: z.string().max(300).optional(), options: z.array(optionSchema).min(2).max(8), other: z.boolean().optional().describe("Also offer a free-text \"Other\".") }),
  z.object({ id: z.string().min(1).max(40), kind: z.literal("text"), question: z.string().trim().min(1).max(200), help: z.string().max(300).optional(), placeholder: z.string().max(120).optional() }),
  z.object({ id: z.string().min(1).max(40), kind: z.literal("scale"), question: z.string().trim().min(1).max(200), help: z.string().max(300).optional(), minLabel: z.string().trim().min(1).max(40), maxLabel: z.string().trim().min(1).max(40) }),
]);
/** What the form sends back; untrusted, so kept to plain values. */
const answersSchema = z.record(z.string().max(40), z.union([z.string().max(2000), z.array(z.string().max(200)).max(8), z.number().int().min(1).max(5), z.object({ decide: z.literal(true) })]));

/** Generous for one hand-written screen; keeps a runaway write from filling the database. */
const MAX_SCREEN_CHARS = 400_000;
/** Above this, design_read lists screens instead of inlining their HTML. */
const MAX_READ_CHARS = 120_000;

const designViewSchema: z.ZodType<DesignView> = z.object({
  id: z.string(),
  name: z.string(),
  projectId: z.string().nullable(),
  threadId: z.string().nullable(),
  updatedAt: z.number(),
  rounds: z.array(z.object({
    round: z.number(),
    title: z.string(),
    intro: z.string(),
    screens: z.array(z.object({
      id: z.string(),
      round: z.number(),
      option: z.string(),
      title: z.string(),
      caption: z.string(),
      viewport: z.enum(VIEWPORT_NAMES as ["desktop", "tablet", "mobile"]),
      updatedAt: z.number(),
      steps: z.array(z.object({ id: z.string(), label: z.string() })),
    })),
  })),
  comments: z.array(z.object({
    id: z.string(),
    screenId: z.string(),
    step: z.string(),
    selector: z.string(),
    elementText: z.string(),
    body: z.string(),
    createdAt: z.number(),
    sent: z.boolean(),
  })),
  review: z.object({
    state: z.enum(["reviewing", "done", "needs_work", "failed"]),
    round: z.number().nullable(),
    screens: z.array(z.string()),
    at: z.number(),
    summary: z.string().nullable(),
  }).nullable(),
});

export const rpcContract = defineRpcContract({
  getDesign: {
    input: z.object({ id: z.string() }),
    output: z.object({ design: designViewSchema.nullable() }),
  },
  renameDesign: {
    input: z.object({ id: z.string(), name: z.string().max(200) }),
    output: z.object({ ok: z.boolean(), updatedAt: z.number() }),
  },
  deleteDesign: {
    input: z.object({ id: z.string() }),
    output: z.object({ ok: z.boolean() }),
  },
  /** Pins a comment to an element of a screen; `send` also posts it to the design's conversation. */
  addComment: {
    input: z.object({
      designId: z.string(),
      screenId: z.string().regex(SCREEN_ID),
      step: z.string().regex(/^[A-Za-z0-9_-]{0,40}$/).default(""),
      selector: z.string().min(1).max(2000),
      elementHtml: z.string().max(5000),
      elementText: z.string().max(400),
      body: z.string().trim().min(1).max(4000),
      send: z.boolean(),
    }),
    output: z.object({ id: z.string(), sent: z.boolean() }),
  },
  sendComment: {
    input: z.object({ id: z.string() }),
    output: z.object({ ok: z.boolean() }),
  },
  resolveComment: {
    input: z.object({ id: z.string(), resolved: z.boolean() }),
    output: z.object({ ok: z.boolean() }),
  },
  deleteComment: {
    input: z.object({ id: z.string() }),
    output: z.object({ ok: z.boolean() }),
  },
});


/** What the agent receives for a comment: the note, the element, and how to act on it. */
export function commentMessage(design: Pick<DesignRow, "id" | "name">, comment: CommentRow): string {
  const name = design.name.trim() || "Untitled design";
  return [
    `Comment on screen ${comment.screen_id}${comment.step ? `, step "${comment.step}"` : ""} of the design "${name}" (id ${design.id}, comment ${comment.id}):`,
    "",
    ...comment.body.split("\n").map((line) => `> ${line}`),
    "",
    `On this element (selector \`${comment.selector}\`):`,
    "```html",
    comment.element_html,
    "```",
    "",
    "Change only what the comment asks, with design_edit_screen. Then resolve it with design_resolve_comments.",
  ].join("\n");
}

/**
 * Screens run the agent's HTML and scripts. The sandbox gives them an opaque
 * origin even when opened directly, so they can't reach BB's cookies, storage
 * or API. Fonts, images and scripts may load from https (Google Fonts, CDNs).
 */
const SCREEN_CSP = [
  "sandbox allow-scripts allow-forms allow-modals allow-popups",
  "default-src 'none'",
  "script-src 'unsafe-inline' https:",
  "style-src 'unsafe-inline' https:",
  "img-src data: blob: https:",
  "font-src data: https:",
  "media-src data: blob: https:",
  "connect-src https:",
].join("; ");

export default async function plugin(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const store = new DesignStore(db);
  const services = studioServices(bb.sdk);
  const studio = studioSchemas(z);

  // Agents write a screen at a time; Studio only needs to hear about it now and then.
  const changeBus = createChangeBus({ bb, channel: REALTIME_CHANNEL, pluginId: PLUGIN_ID, schemas: studio, event: (id, updatedAt, by) => ({ type: DESIGN_UPDATE_TYPE, designId: id, updatedAt, by }), delayMs: 1000 });
  const changed = (id: string, updatedAt: number, by: Writer | "studio") => changeBus.changed(id, updatedAt, by);
  /** Tells Studio an agent made a design, so it joins the thread's spaces. */
  const created = (id: string, threadId: string) => void services.created({ pluginId: PLUGIN_ID, id }, threadId).catch(() => { /* Studio is optional. */ });

  // ---------------------------------------------------------------------
  // Reviews (src/server/review.ts). The latest per design lives in memory:
  // a restart forgets it, and the canvas then shows no status.
  // ---------------------------------------------------------------------
  const reviews = new Map<string, ReviewState>();
  /** Bounds a review: a stuck reviewer is stopped, and the round counts as unreviewed. */
  const REVIEW_TIMEOUT_MS = 15 * 60_000;
  const disposed = new AbortController();

  function setReview(designId: string, review: ReviewState) {
    reviews.set(designId, review);
    const row = store.get(designId);
    if (row) changed(designId, store.bump(designId, "agent"), "agent");
  }

  /** Runs one review in a hidden thread beside the design's own, and reports back. */
  async function review(designId: string, screenIds: string[], requesterThreadId: string) {
    const row = store.get(designId);
    if (!row) return;
    const round = screenIds.length ? Number(screenIds[0]!.slice(0, -1)) : null;
    setReview(designId, { state: "reviewing", round, screens: screenIds, at: Date.now(), summary: null });
    let reviewerId: string | null = null;
    try {
      const requester = await bb.sdk.threads.get({ threadId: requesterThreadId });
      const hostId = (await bb.sdk.system.config()).primaryHostId;
      if (!hostId) throw new Error("This BB server has no local machine to run the reviewer's browser on.");
      const screens = screenIds.flatMap((id) => {
        const screen = store.screen(designId, id);
        return screen ? [{ id, caption: screen.caption, viewport: (screen.viewport as "desktop") ?? "desktop", steps: parseSteps(screen.html), url: screenUrl(designId, id, screen.updated_at) }] : [];
      });
      const prompt = reviewerPrompt({
        designName: displayName(row),
        designId,
        round,
        screens,
        targets: reviewTargets(bb.server.loopbackBaseUrl, screens),
        hostId,
        rules: "The \"Taste rules\" and \"Writing screens\" sections of the design skill. Read the skill first.",
      });
      const reviewer = await bb.sdk.threads.spawn({
        projectId: requester.projectId,
        environment: { type: "reuse", environmentId: requester.environmentId },
        providerId: requester.providerId,
        title: `Review: ${displayName(row)}${round ? `, round ${round}` : ""}`,
        visibility: "hidden",
        pluginMetadata: { role: "design-reviewer", designId },
        prompt,
      } as Parameters<typeof bb.sdk.threads.spawn>[0]);
      reviewerId = reviewer.id;
      const signal = AbortSignal.any([disposed.signal, AbortSignal.timeout(REVIEW_TIMEOUT_MS)]);
      // Wait for it to start, then to finish; a fast reviewer may already be done.
      await bb.sdk.threads.wait({ threadId: reviewer.id, status: "active", timeoutMs: 60_000, signal }).catch(() => undefined);
      await bb.sdk.threads.wait({ threadId: reviewer.id, status: "idle", signal });
      const { output } = await bb.sdk.threads.output({ threadId: reviewer.id });
      const { verdict, findings } = parseVerdict(output ?? "");
      if (verdict === "needs_work") {
        setReview(designId, { state: "needs_work", round, screens: screenIds, at: Date.now(), summary: findings || null });
        const thread = store.get(designId)?.thread_id ?? requesterThreadId;
        await bb.sdk.threads.send({
          threadId: thread,
          input: [{ type: "text", mentions: [], text: [`The reviewer checked ${round ? `round ${round}` : "the screens"} of "${displayName(row)}" and found problems:`, "", findings, "", "Fix them, then call design_ready again."].join("\n") }],
          mode: "queue-if-active",
        });
      } else if (verdict === "done") {
        setReview(designId, { state: "done", round, screens: screenIds, at: Date.now(), summary: null });
      } else {
        throw new Error(`The reviewer ended without a verdict (expected "${VERDICT_DONE}" or "needs_work").`);
      }
    } catch (error) {
      bb.log.warn(`review of ${designId} failed: ${error instanceof Error ? error.message : String(error)}`);
      setReview(designId, { state: "failed", round, screens: screenIds, at: Date.now(), summary: error instanceof Error ? error.message : String(error) });
    } finally {
      // Hidden workers must always be released, or the agent process lingers.
      if (reviewerId) {
        await bb.sdk.threads.archive({ threadId: reviewerId }).catch(() => undefined);
        await bb.sdk.threads.stop({ threadId: reviewerId }).catch(() => undefined);
      }
    }
  }

  /** Posts a comment to the design's conversation; it waits for a running turn instead of cutting in. */
  async function sendToThread(row: DesignRow, comment: CommentRow) {
    await bb.sdk.threads.send({ threadId: row.thread_id!, input: [{ type: "text", text: commentMessage(row, comment), mentions: [] }], mode: "queue-if-active" });
    store.markSent(comment.id);
  }

  bb.rpc.register(rpcContract, {
    getDesign({ id }) {
      const view = store.view(id);
      return { design: view ? { ...view, review: reviews.get(id) ?? null } : null };
    },
    renameDesign({ id, name }) {
      if (!store.get(id)) throw new Error("Design not found.");
      const updatedAt = store.rename(id, name.trim(), "editor");
      changed(id, updatedAt, "editor");
      return { ok: true, updatedAt };
    },
    deleteDesign({ id }) {
      if (store.delete(id)) changed(id, Date.now(), "app");
      return { ok: true };
    },
    async addComment({ designId, screenId, step, selector, elementHtml, elementText, body, send }) {
      const row = store.get(designId);
      if (!row) throw new Error("Design not found.");
      if (!store.screen(designId, screenId)) throw new Error(`Screen ${screenId} not found.`);
      if (send && !row.thread_id) throw new Error("This design has no conversation yet. Start one with Chat, then send the comment.");
      const comment = store.addComment(designId, { screenId, step, selector, elementHtml, elementText, body });
      if (send) await sendToThread(row, comment);
      changed(designId, store.bump(designId, "editor"), "editor");
      return { id: comment.id, sent: send };
    },
    async sendComment({ id }) {
      const comment = store.comment(id);
      const row = comment ? store.get(comment.design_id) : null;
      if (!comment || !row) throw new Error("Comment not found.");
      if (!row.thread_id) throw new Error("This design has no conversation yet. Start one with Chat, then send the comment.");
      await sendToThread(row, comment);
      changed(row.id, store.bump(row.id, "editor"), "editor");
      return { ok: true };
    },
    resolveComment({ id, resolved }) {
      const comment = store.comment(id);
      if (!comment) throw new Error("Comment not found.");
      store.setResolved(id, resolved);
      changed(comment.design_id, store.bump(comment.design_id, "editor"), "editor");
      return { ok: true };
    },
    deleteComment({ id }) {
      const comment = store.comment(id);
      if (!comment) return { ok: true };
      store.deleteComment(id);
      changed(comment.design_id, store.bump(comment.design_id, "editor"), "editor");
      return { ok: true };
    },
  });

  registerStudio(bb, studio, {
    store,
    changed: (id) => changed(id, store.get(id)?.updated_at ?? Date.now(), "studio"),
  });

  // One screen's HTML, for the canvas frames and the reviewer's browser. The
  // URL carries the design's revision, so a cached response never goes stale.
  bb.http.route("GET", "/screen", (context) => {
    const screen = store.screen(context.req.query("design") ?? "", context.req.query("screen") ?? "");
    if (!screen) return context.text("Not found", 404);
    return serveBytes(withScreenScript(screen.html), {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": SCREEN_CSP,
    });
  });

  // ---------------------------------------------------------------------
  // Agent tools. The design method itself lives in skills/design/SKILL.md.
  // ---------------------------------------------------------------------

  const notFound = (id: string) => ({ content: [{ type: "text" as const, text: `Design ${id} not found.` }], isError: true });
  const fail = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });
  const link = (id: string, name: string) => `[${name.replace(/[[\]]/g, "")}](${designHref(id)})`;
  /** The reply card that opens the design in the user's workbench. */
  const card = (id: string) => `Put this line on its own in your reply so the user can open the design beside the chat:\n::design{id="${id}"}`;
  const screenIdSchema = z.string().regex(SCREEN_ID, 'A round number and an option letter, like "1a" or "2b".');

  bb.agents.registerTool({
    name: "design_list",
    description: "List the user's designs (id, name, screen count, last updated). Use when the user refers to an existing design.",
    presentation: { label: { pending: "Listing designs", completed: "Listed designs" } },
    parameters: z.object({}),
    execute() {
      const rows = store.list({ limit: 100 });
      if (!rows.length) return "No designs yet. Use design_create to make one.";
      return `Designs:\n${rows.map((row) => `- ${displayName(row)} (id ${row.id}): ${store.screens(row.id).length} screen(s), updated ${new Date(row.updated_at).toISOString()}, link ${designHref(row.id)}`).join("\n")}`;
    },
  });

  bb.agents.registerTool({
    name: "design_create",
    description: "Create an empty design in the current project and return its id and link. Follow the design skill before writing its first screen.",
    instructions: "For UI design work (prototypes, screens, flows), use the design_* tools and follow the design skill.",
    presentation: { label: { pending: "Creating a design", completed: "Created a design" } },
    parameters: z.object({ name: z.string().min(1).max(200) }),
    execute({ name }, ctx) {
      const row = store.create({ name, projectId: ctx.projectId ?? null, by: "agent" });
      if (ctx.threadId) store.setThread(row.id, ctx.threadId);
      changed(row.id, row.updated_at, "agent");
      if (ctx.threadId) created(row.id, ctx.threadId);
      return `Created design "${name}" (id ${row.id}). Link: ${link(row.id, name)}\n${card(row.id)}`;
    },
  });

  bb.agents.registerTool({
    name: "design_rename",
    description: "Rename a design. Give a new design a short, specific name once you know what it is (\"Forkful onboarding\", not \"Design\").",
    presentation: { label: { pending: "Renaming a design", completed: "Renamed a design" } },
    parameters: z.object({ designId: z.string().min(1), name: z.string().trim().min(1).max(200) }),
    execute({ designId, name }) {
      if (!store.get(designId)) return notFound(designId);
      changed(designId, store.rename(designId, name, "agent"), "agent");
      return `Renamed the design to "${name}".`;
    },
  });

  bb.agents.registerTool({
    name: "design_read",
    description: "Read a design: its rounds, each option's id, caption and frame size, and the HTML of the screens you name (or of the newest round when you name none). Call it before editing so you see the latest version.",
    presentation: { label: { pending: "Reading a design", completed: "Read a design" } },
    parameters: z.object({
      designId: z.string().min(1),
      screenIds: z.array(screenIdSchema).max(12).optional(),
    }),
    execute({ designId, screenIds }) {
      const view = store.view(designId);
      if (!view) return notFound(designId);
      const wanted = screenIds?.length ? screenIds : view.rounds[0]?.screens.map((screen) => screen.id) ?? [];
      const html = Object.fromEntries(wanted.flatMap((id) => {
        const screen = store.screen(designId, id);
        return screen ? [[id, screen.html]] : [];
      }));
      const payload = JSON.stringify({ design: { ...view, name: displayName(view), link: designHref(view.id) }, html }, null, 2);
      if (payload.length <= MAX_READ_CHARS) return payload;
      return [
        JSON.stringify({ design: { ...view, name: displayName(view), link: designHref(view.id) } }, null, 2),
        `The HTML of ${wanted.join(", ")} is ${payload.length} characters, too large to inline. Read fewer screens at a time with screenIds.`,
      ].join("\n\n");
    },
  });

  bb.agents.registerTool({
    name: "design_write_screen",
    description: "Create or replace one screen of a design. The screen id names its round and option: \"1a\" is round 1, option a. Start a new round with a new number; keep earlier rounds unchanged. Pass a complete, self-contained HTML document. For a multi-step prototype, declare its steps so the canvas splays them out side by side: <meta name=\"bb-design-steps\" content=\"welcome=Welcome; address=Delivery address\">, and open the prototype at the step named by location.hash (#address), on load and on hashchange. The user's open canvas updates live.",
    presentation: { label: { pending: "Writing a screen", completed: "Wrote a screen" } },
    parameters: z.object({
      designId: z.string().min(1),
      screenId: screenIdSchema,
      html: z.string().min(1).max(MAX_SCREEN_CHARS),
      caption: z.string().max(300).optional().describe("One line on what this option tries, shown above its frame."),
      viewport: z.enum(VIEWPORT_NAMES as ["desktop", "tablet", "mobile"]).optional().describe("Frame size on the canvas. Defaults to desktop."),
      roundTitle: z.string().max(200).optional().describe("Sets the round's heading."),
      roundIntro: z.string().max(2000).optional().describe("Sets the round's short intro: what this round explores and how the options differ."),
    }),
    execute({ designId, screenId, html, caption, viewport, roundTitle, roundIntro }, ctx) {
      const row = store.get(designId);
      if (!row) return notFound(designId);
      // A design written from a thread shows that thread beside its canvas.
      if (!row.thread_id && ctx.threadId) {
        store.setThread(designId, ctx.threadId);
        created(designId, ctx.threadId);
      }
      const existed = store.screen(designId, screenId) !== null;
      let updatedAt = store.writeScreen(designId, { id: screenId, html, caption, viewport }, "agent");
      if (roundTitle !== undefined || roundIntro !== undefined)
        updatedAt = store.setRound(designId, Number(screenId.slice(0, -1)), { title: roundTitle, intro: roundIntro }, "agent");
      changed(designId, updatedAt, "agent");
      const steps = parseSteps(html);
      const unnamed = !row.name.trim() ? `\nThis design has no name yet: give it a short, specific one with design_rename.` : "";
      return `${existed ? "Replaced" : "Added"} screen ${screenId} in "${displayName(row)}" (${screenText(html).length} characters of text${steps.length ? `, ${steps.length} steps: ${steps.map((step) => `#${step.id}`).join(", ")}` : ""}). The user's open canvas shows it now.${unnamed}\n${card(designId)}`;
    },
  });

  bb.agents.registerTool({
    name: "design_edit_screen",
    description: "Make a targeted change to one screen: replace an exact snippet of its HTML. The snippet must appear exactly once; include enough surrounding markup to make it unique. Prefer this over design_write_screen for small requests, so nothing else changes.",
    presentation: { label: { pending: "Editing a screen", completed: "Edited a screen" } },
    parameters: z.object({
      designId: z.string().min(1),
      screenId: screenIdSchema,
      find: z.string().min(1),
      replace: z.string(),
    }),
    execute({ designId, screenId, find, replace }) {
      const row = store.get(designId);
      if (!row) return notFound(designId);
      const screen = store.screen(designId, screenId);
      if (!screen) return fail(`Screen ${screenId} not found in "${displayName(row)}". Read the design with design_read.`);
      const first = screen.html.indexOf(find);
      if (first < 0) return fail(`The snippet isn't in screen ${screenId}. Read it again with design_read; the user or another edit may have changed it.`);
      if (screen.html.indexOf(find, first + 1) >= 0) return fail("The snippet appears more than once. Include more surrounding markup so it matches one place.");
      const html = screen.html.slice(0, first) + replace + screen.html.slice(first + find.length);
      if (html.length > MAX_SCREEN_CHARS) return fail(`The screen would be over ${MAX_SCREEN_CHARS} characters.`);
      const updatedAt = store.writeScreen(designId, { id: screenId, html }, "agent");
      changed(designId, updatedAt, "agent");
      return `Edited screen ${screenId} in "${displayName(row)}". The user's open canvas shows it now.`;
    },
  });

  bb.agents.registerTool({
    name: "design_ask",
    description: "Ask the user a short form of questions before designing, when the answers would change what you build and you can't find them yourself: the look is open (no design system, references or art direction), or the brief leaves out the platform, audience or flows. One round, at most 12 questions; never ask what the chat already settled, and don't ask for small follow-up edits. Kinds: choice (one option), multi (several), text (short answer), scale (1 to 5 between two labels). Every question gets a \"Decide for me\". The user's answers come back as this tool's result.",
    presentation: { label: { pending: "Waiting for answers", completed: "Got answers" } },
    parameters: z.object({
      title: z.string().trim().min(1).max(120).optional().describe("Defaults to \"A few questions\"."),
      intro: z.string().max(400).optional().describe("One sentence on why you're asking."),
      questions: z.array(questionSchema).min(1).max(12),
    }),
    async execute({ title, intro, questions }, ctx) {
      if (!ctx.threadId) return fail("Questions need a thread to show in.");
      const ids = questions.map((question) => question.id);
      if (new Set(ids).size !== ids.length) return fail("Each question needs its own id.");
      const form: QuestionForm = { title: title ?? "A few questions", ...(intro ? { intro } : {}), questions };
      const result = await bb.ui.requestInput({
        threadId: ctx.threadId,
        rendererId: QUESTIONS_RENDERER,
        title: form.title,
        payload: form as never,
        // People think about these; give them the longest the host allows.
        timeoutMs: 60 * 60_000,
        presentation: { label: { pending: "Waiting for your answers", completed: "Questions answered" } },
        describeSubmission: (value) => {
          const parsed = answersSchema.safeParse(value);
          return { title: "Questions answered", detail: parsed.success ? summarizeAnswers(form, parsed.data as Answers) : undefined };
        },
      }, { signal: ctx.signal });
      if (result.outcome === "cancelled") return "The user closed the questions without answering. Go ahead with sensible defaults and list the assumptions you made.";
      const parsed = answersSchema.safeParse(result.value);
      if (!parsed.success) return fail("The answers didn't come back in a readable form. Ask again, or go ahead with sensible defaults.");
      return `Questions answered:\n${summarizeAnswers(form, parsed.data as Answers)}\n\nUse these answers; for "you decide", choose well and say what you chose.`;
    },
  });

  bb.agents.registerTool({
    name: "design_ready",
    description: "Call when a round (or a change) is ready for the user. A separate reviewer checks the screens in the background: it loads them at their size, takes screenshots, and checks layout, errors, steps and the design rules. It only comes back to you, in this thread, when something needs fixing. Don't call the work done until then. Pass skipReview for trivial edits (a word, a color).",
    presentation: { label: { pending: "Sending for review", completed: "Sent for review" } },
    parameters: z.object({
      designId: z.string().min(1),
      screenIds: z.array(screenIdSchema).max(12).optional().describe("Defaults to the newest round."),
      skipReview: z.boolean().optional(),
    }),
    execute({ designId, screenIds, skipReview }, ctx) {
      const view = store.view(designId);
      if (!view) return notFound(designId);
      const ids = screenIds?.length ? screenIds : view.rounds[0]?.screens.map((screen) => screen.id) ?? [];
      const missing = ids.filter((id) => !store.screen(designId, id));
      if (!ids.length) return fail("The design has no screens to review yet.");
      if (missing.length) return fail(`Not in this design: ${missing.join(", ")}.`);
      if (skipReview) return `Marked ready without a review.\n${card(designId)}`;
      if (!ctx.threadId) return fail("A review needs a thread to report back to.");
      if (reviews.get(designId)?.state === "reviewing") return "A review of this design is already running. It reports back here if anything needs fixing.";
      void review(designId, ids, ctx.threadId);
      return `Sent ${ids.join(", ")} for review. The reviewer reports back in this thread only if something needs fixing; until then, say the work is out for review, not done. Keep your summary short.\n${card(designId)}`;
    },
  });

  bb.agents.registerTool({
    name: "design_comments",
    description: "List the comments the user pinned to elements of a design's screens: each comment's id, screen, the element's selector and markup, and the note. Open comments only unless includeResolved is set.",
    presentation: { label: { pending: "Reading comments", completed: "Read comments" } },
    parameters: z.object({ designId: z.string().min(1), includeResolved: z.boolean().optional() }),
    execute({ designId, includeResolved }) {
      const row = store.get(designId);
      if (!row) return notFound(designId);
      const comments = store.comments(designId, { includeResolved });
      if (!comments.length) return `"${displayName(row)}" has no ${includeResolved ? "" : "open "}comments.`;
      return comments.map((comment) => [commentMessage(row, comment).split("\n\nChange only")[0], comment.resolved_at ? "(resolved)" : ""].join("\n")).join("\n\n---\n\n");
    },
  });

  bb.agents.registerTool({
    name: "design_resolve_comments",
    description: "Mark comments resolved once you've made the change they asked for. Their pins leave the canvas.",
    presentation: { label: { pending: "Resolving comments", completed: "Resolved comments" } },
    parameters: z.object({ designId: z.string().min(1), commentIds: z.array(z.string().min(1)).min(1).max(100) }),
    execute({ designId, commentIds }) {
      if (!store.get(designId)) return notFound(designId);
      const missing = commentIds.filter((id) => store.comment(id)?.design_id !== designId);
      for (const id of commentIds) if (!missing.includes(id)) store.setResolved(id, true);
      changed(designId, store.bump(designId, "agent"), "agent");
      return missing.length ? `Resolved ${commentIds.length - missing.length}; not in this design: ${missing.join(", ")}.` : `Resolved ${commentIds.length} comment(s).`;
    },
  });

  bb.agents.configure(() => ({
    tools: ["design_list", "design_create", "design_rename", "design_read", "design_ask", "design_ready", "design_write_screen", "design_edit_screen", "design_comments", "design_resolve_comments"],
    skills: [],
  }));

  // `@design` in any composer: the agent gets the design's rounds and its newest screens' text.
  bb.ui.registerMentionProvider(defineItemMention({
    id: "design",
    label: "Designs",
    search({ query }) {
      const q = query.trim().toLowerCase();
      return store
        .list({ limit: 50 })
        .filter((row) => !q || displayName(row).toLowerCase().includes(q))
        .map((row) => ({ id: row.id, title: displayName(row), subtitle: `${store.screens(row.id).length} screens` }));
    },
    resolve(itemId) {
      const view = store.view(itemId);
      if (!view) throw new Error(`Design ${itemId} not found`);
      const rounds = view.rounds.map((round) => [
        `Round ${round.round}${round.title ? `: ${round.title}` : ""}`,
        ...round.screens.map((screen) => `- ${screen.id} (${screen.viewport})${screen.caption ? `: ${screen.caption}` : ""}`),
      ].join("\n"));
      return {
        context: [
          `Design "${displayName(view)}" (id ${view.id}, link ${designHref(view.id)}).`,
          rounds.length ? rounds.join("\n\n") : "It has no screens yet.",
          "Read its HTML with design_read before changing it.",
        ].join("\n\n"),
      };
    },
  }));

  bb.onDispose(() => {
    disposed.abort();
    changeBus.dispose();
  });
  bb.log.info("loaded");
}
