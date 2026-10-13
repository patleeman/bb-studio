import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it, vi } from "vitest";
import { Bots, BOT_ID } from "./bot";
import { AVATAR_HISTORY, avatarImageUrl, ImageNotSetUpError, imageMime, openaiImageProvider, pickImageProvider, xaiImageProvider, type ImageProvider } from "./bot-avatar";
import { registerBotProfileTools } from "./bot-profile-tools";
import { MIGRATIONS } from "./migrations";
import { PERSONAL_PROJECT_ID, ProjectLeads } from "./project-lead";

const dispose: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of dispose.splice(0)) await fn(); });

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

/** Two Bots: the primary (thr_main) and Scout (thr_scout); thr_child was started by Scout's thread. */
async function setup() {
  const parents: Record<string, string> = { thr_child: "thr_scout" };
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: {
    threads: {
      get: (async ({ threadId }: { threadId: string }) => ({ id: threadId, parentThreadId: parents[threadId] ?? null })) as never,
      defaultExecutionOptions: (async () => ({ model: "model" })) as never,
    },
  } });
  dispose.push(() => harness.lifecycle.dispose());
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const leads = new ProjectLeads({ db, sdk: bb.sdk, changed: () => {}, personalPrompt: () => "", botPrompt: () => null });
  const bots = new Bots({ db, sdk: bb.sdk, leads, changed: () => {} });
  db.prepare("INSERT INTO project_leads VALUES (?, ?, 1, 2)").run(PERSONAL_PROJECT_ID, "thr_main");
  const insert = db.prepare("INSERT INTO bots (id, name, avatar, state, thread_id, heartbeat_was_on, created_at, updated_at) VALUES (?, ?, '🤖', 'active', ?, 0, ?, ?)");
  insert.run(BOT_ID, "Dot", "thr_main", 1, 1);
  insert.run("bot_scout", "Scout", "thr_scout", 2, 2);
  return { bb, harness, db, bots };
}

it("tells an image's type from its bytes", () => {
  expect(imageMime(PNG)).toBe("image/png");
  expect(imageMime(JPEG)).toBe("image/jpeg");
  expect(imageMime(Buffer.from("<svg></svg>"))).toBeNull();
});

it("says image generation isn't set up without a key, and picks OpenAI, then xAI, settings before the environment", () => {
  expect(() => pickImageProvider({ settings: {}, env: {} })).toThrow(ImageNotSetUpError);
  expect(() => pickImageProvider({ settings: {}, env: {} })).toThrow(/^Image generation isn't set up: .*OPENAI_API_KEY or XAI_API_KEY/);
  expect(pickImageProvider({ settings: {}, env: { XAI_API_KEY: "x" } }).id).toBe("xai");
  expect(pickImageProvider({ settings: { botAvatarXaiApiKey: "x" }, env: { OPENAI_API_KEY: "o" } }).id).toBe("openai");
  expect(pickImageProvider({ settings: { botAvatarXaiApiKey: "x", botAvatarOpenaiApiKey: "  " }, env: {} }).id).toBe("xai");
});

it("calls the provider's images API with the key and reads the base64 image", async () => {
  const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ data: [{ b64_json: PNG.toString("base64") }] })));
  const image = await openaiImageProvider("sk-test", { fetch: fetch as never }).generate("an owl");
  expect(image).toEqual({ data: PNG, mime: "image/png", model: "gpt-image-1" });
  const [url, init] = fetch.mock.calls[0]!;
  expect(url).toBe("https://api.openai.com/v1/images/generations");
  expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
  expect(JSON.parse(init.body as string)).toMatchObject({ model: "gpt-image-1", prompt: "an owl", quality: "low" });
  const xai = vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: JPEG.toString("base64") }] })));
  expect(await xaiImageProvider("xai-test", { fetch: xai as never }).generate("an owl")).toMatchObject({ mime: "image/jpeg", model: "grok-2-image" });
});

it("reports a provider's error without the key", async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ error: { message: "Billing hard limit reached" } }), { status: 400 }));
  await expect(openaiImageProvider("sk-secret", { fetch: fetch as never }).generate("x")).rejects.toThrow("OpenAI couldn't make the image (400): Billing hard limit reached");
  await expect(openaiImageProvider("sk-secret", { fetch: fetch as never }).generate("x")).rejects.not.toThrow(/sk-secret/);
});

it("keeps a Bot's last few images, never pruning the shown one or Revert's, and Revert flips back", async () => {
  const { bots } = await setup();
  expect(bots.stored()?.avatarImageUrl).toBeNull();
  const first = bots.addAvatarImage(undefined, { data: PNG, mime: "image/png", source: "generated", prompt: "one" });
  const firstId = bots.avatarHistory().current!;
  expect(first.avatarImageUrl).toBe(avatarImageUrl(BOT_ID, firstId));
  // Revert from the first image goes back to the drawn avatar, and again to the image.
  expect(bots.avatarHistory().previous).toBe("");
  expect(bots.revertAvatar().avatarImageUrl).toBeNull();
  expect(bots.revertAvatar().avatarImageUrl).toBe(avatarImageUrl(BOT_ID, firstId));
  for (let i = 0; i < AVATAR_HISTORY + 2; i++) bots.addAvatarImage(undefined, { data: JPEG, mime: "image/jpeg", source: "upload" });
  const history = bots.avatarHistory();
  expect(history.images).toHaveLength(AVATAR_HISTORY);
  expect(history.images[0]!.id).toBe(history.current);
  expect(history.images.map((image) => image.id)).toContain(history.previous);
  expect(history.images.map((image) => image.id)).not.toContain(firstId);
  // Picking an older one keeps the current as Revert's target.
  const older = history.images[3]!.id;
  bots.useAvatarImage(undefined, older);
  expect(bots.avatarHistory()).toMatchObject({ current: older, previous: history.current });
  expect(() => bots.useAvatarImage(undefined, firstId)).toThrow(/gone/);
  // Another Bot's images are its own.
  expect(bots.avatarImage("bot_scout", older)).toBeUndefined();
  expect(bots.avatarImage(BOT_ID, older)?.mime).toBe("image/jpeg");
  expect(() => bots.revertAvatar("bot_scout")).toThrow(/no earlier avatar/);
});

it("bot_avatar_generate sets the calling Bot's avatar, from its own thread or one it started", async () => {
  const { bb, harness, bots } = await setup();
  const generate = vi.fn(async () => ({ data: PNG, mime: "image/png", model: "test-model" }));
  const provider: ImageProvider = { id: "test", label: "Test", generate };
  registerBotProfileTools(bb, { bots, acting: (threadId) => bots.actingFor(threadId), imageProvider: () => provider });
  expect(await harness.callAgentTool("bot_avatar_generate", { prompt: "a lighthouse" }, { threadId: "thr_child" })).toMatch(/^Scout's avatar is now the new image/);
  expect(generate).toHaveBeenCalledWith(expect.stringContaining("named \"Scout\". a lighthouse"));
  expect(bots.stored("bot_scout")?.avatarImageUrl).toMatch(/bot=bot_scout&image=bai_/);
  expect(bots.stored()?.avatarImageUrl).toBeNull();
  expect(bots.avatarHistory("bot_scout").images[0]).toMatchObject({ source: "generated", prompt: "a lighthouse", provider: "test/test-model" });
  // Elsewhere, the primary Bot's.
  await harness.callAgentTool("bot_avatar_generate", { prompt: "a fox" }, { threadId: "thr_loose" });
  expect(bots.stored()?.avatarImageUrl).toMatch(/bot=bot_main/);
});

it("bot_avatar_generate fails before any spend when image generation isn't set up", async () => {
  const { bb, harness, bots } = await setup();
  registerBotProfileTools(bb, { bots, acting: (threadId) => bots.actingFor(threadId), imageProvider: () => pickImageProvider({ settings: {}, env: {} }) });
  await expect(harness.callAgentTool("bot_avatar_generate", { prompt: "a fox" }, { threadId: "thr_main" })).rejects.toThrow(/^Image generation isn't set up/);
  expect(bots.avatarHistory().images).toEqual([]);
});
