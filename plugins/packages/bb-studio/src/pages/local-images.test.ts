import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isLocalImageSrc, PAGE_FILES_URL, PAGE_LOCAL_IMAGE_URL, pageImageUrl } from "../kit/pages-contract";
import { HUMAN_USER_ID } from "./constants";
import { pageLocalImage, threadImageReader } from "./local-image-reader";
import {
  LOCAL_IMAGE_URL,
  MAX_IMAGE_BYTES,
  loadLocalImages,
  localImagePath,
  localImageSrcs,
  replaceImageSrcs,
  sniffImage,
  type ImageReader,
} from "./local-images";
import { PagesService } from "./service";
import { MIGRATIONS, PageStore } from "./store";
import { registerTools } from "./tools";
import { chatMarkdown } from "./ui/page-preview";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const GIF = new TextEncoder().encode("GIF89a....");
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const FILE_URL = new RegExp(`^${PAGE_FILES_URL.replace(/[/?]/g, "\\$&")}\\?id=(file_[\\w-]+)$`);

let dir: string;
let workspace: string;
let storage: string;
let outside: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "page-images-"));
  workspace = join(dir, "workspace");
  storage = join(dir, "data", "thread-storage", "thr_writer");
  outside = join(dir, "elsewhere");
  for (const folder of [workspace, storage, outside]) mkdirSync(folder, { recursive: true });
});
const services: PagesService[] = [];
afterEach(() => {
  for (const service of services.splice(0)) service.hub.disposeAll();
  rmSync(dir, { recursive: true, force: true });
});

/** The SDK calls a thread image reader makes, over real files. */
function fakeSdk(roots: Record<string, { workspace: string | null; storage: string }> = {}) {
  const reads: string[] = [];
  const sdk = {
    threads: {
      get: async ({ threadId }: { threadId: string }) => {
        const thread = roots[threadId] ?? { workspace, storage };
        return { projectId: "proj_a", title: "Writer", environment: thread.workspace ? { hostId: "host_a", path: thread.workspace } : null };
      },
      storageLocation: async ({ threadId }: { threadId: string }) => ({ hostId: "host_a", storageRootPath: (roots[threadId] ?? { storage }).storage }),
    },
    files: {
      read: async ({ path }: { hostId: string; rootPath: string; path: string }) => {
        reads.push(path);
        const info = await stat(path);
        return { content: (await readFile(path)).toString("base64"), contentEncoding: "base64", sizeBytes: info.size, mimeType: "application/octet-stream" };
      },
    },
  };
  return { sdk, reads };
}

function setup(roots?: Parameters<typeof fakeSdk>[0]) {
  const db = new Database(":memory:");
  for (const sql of MIGRATIONS) db.exec(sql);
  const store = new PageStore(db);
  const { sdk, reads } = fakeSdk(roots);
  const tools = new Map<string, { execute: (params: unknown, ctx: unknown) => Promise<unknown> }>();
  const bb = {
    sdk,
    realtime: { publish: () => {} },
    agents: { registerTool: (tool: { name: string; execute: (params: unknown, ctx: unknown) => Promise<unknown> }) => tools.set(tool.name, tool) },
    log: { warn: () => {}, error: () => {} },
  };
  const service = new PagesService(bb as never, store);
  services.push(service);
  registerTools(bb as never, service);
  const ctx = { threadId: "thr_writer", projectId: "proj_a", signal: new AbortController().signal };
  const call = async (name: string, params: unknown) => {
    const result = await tools.get(name)!.execute(params, ctx);
    return typeof result === "string" ? result : JSON.stringify(result);
  };
  return { store, service, bb, call, reads };
}

const fileIds = (markdown: string) => [...markdown.matchAll(/\]\(([^)]+)\)/g)].map((match) => FILE_URL.exec(match[1]!)?.[1]).filter(Boolean) as string[];

describe("finding local images", () => {
  it("takes absolute paths and file URLs, not URLs, app addresses, relative paths or code", () => {
    const markdown = [
      "![a](/tmp/x/a.png) and ![b](<" + "/tmp/My Shots/b.png> \"Shot\")",
      "![c](file:///tmp/x/c.png) ![d](https://example.invalid/d.png) ![e](data:image/png;base64,AA==)",
      `![f](${PAGE_FILES_URL}?id=file_1) ![g](chart.png) ![h](//cdn.invalid/h.png)`,
      "```md",
      "![code](/tmp/x/code.png)",
      "```",
      "`![inline](/tmp/x/inline.png)` is still Markdown here",
    ].join("\n");
    expect(localImageSrcs(markdown)).toEqual(["/tmp/x/a.png", "/tmp/My Shots/b.png", "file:///tmp/x/c.png", "/tmp/x/inline.png"]);
    expect(localImagePath("file:///tmp/My%20Shots/b.png")).toBe("/tmp/My Shots/b.png");
    expect(localImagePath("/tmp/x/../y/a.png")).toBe("/tmp/y/a.png");
    expect(localImagePath("/api/v1/plugins/studio/http/pages/files?id=file_1")).toBeNull();
    expect(isLocalImageSrc("/var/tmp/a.png")).toBe(true);
    expect(isLocalImageSrc("/api/v1/x")).toBe(false);
  });

  it("rewrites only the srcs it was given, keeping alt text and titles", () => {
    const markdown = "![Chart](/tmp/a.png \"Q1\") ![](/tmp/b.png)\n```\n![Chart](/tmp/a.png)\n```";
    expect(replaceImageSrcs(markdown, new Map([["/tmp/a.png", "/new?id=1"]]))).toBe("![Chart](/new?id=1 \"Q1\") ![](/tmp/b.png)\n```\n![Chart](/tmp/a.png)\n```");
  });

  it("knows image types by their bytes", () => {
    expect([PNG, JPEG, GIF, WEBP].map(sniffImage)).toEqual(["image/png", "image/jpeg", "image/gif", "image/webp"]);
    expect(sniffImage(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
  });
});

describe("loadLocalImages", () => {
  const reader = (files: Record<string, Uint8Array | number>): ImageReader => async (path) => {
    const file = files[path];
    if (file === undefined) return { error: "the file was not found" };
    return typeof file === "number" ? { bytes: new Uint8Array(), size: file } : { bytes: file, size: file.byteLength };
  };

  it("loads images and names each one it skips, with why", async () => {
    const result = await loadLocalImages([
      "![](/w/a.png) ![](/w/a.png) ![](/w/photo.JPG)",
      "![](/w/gone.png) ![](/w/big.png) ![](/w/fake.png) ![](/w/logo.svg) ![](/w/notes.txt)",
    ], reader({ "/w/a.png": PNG, "/w/photo.JPG": JPEG, "/w/big.png": MAX_IMAGE_BYTES + 1, "/w/fake.png": new TextEncoder().encode("not an image") }));
    expect(result.loaded.map((image) => [image.src, image.name, image.mime])).toEqual([["/w/a.png", "a.png", "image/png"], ["/w/photo.JPG", "photo.JPG", "image/jpeg"]]);
    expect(result.skipped).toEqual([
      { src: "/w/gone.png", reason: "the file was not found" },
      { src: "/w/big.png", reason: "it is larger than 10 MB" },
      { src: "/w/fake.png", reason: "the file isn't a PNG, JPEG, GIF or WebP image" },
      { src: "/w/logo.svg", reason: expect.stringContaining("SVG images aren't imported") },
      { src: "/w/notes.txt", reason: "only PNG, JPEG, GIF and WebP images are imported" },
    ]);
  });
});

describe("threadImageReader", () => {
  it("reads only inside the thread's workspace and thread storage", async () => {
    writeFileSync(join(storage, "in.png"), PNG);
    writeFileSync(join(outside, "secret.png"), PNG);
    const { sdk, reads } = fakeSdk();
    const read = threadImageReader({ sdk } as never, "thr_writer");
    expect(await read(join(storage, "in.png"))).toMatchObject({ size: PNG.byteLength });
    expect(await read(join(outside, "secret.png"))).toEqual({ error: "it is outside this thread's workspace and thread storage" });
    expect(await read(join(storage, "..", "thr_other", "x.png"))).toEqual({ error: "it is outside this thread's workspace and thread storage" });
    expect(await read(join(storage, "missing.png"))).toEqual({ error: "the file was not found" });
    expect(reads).toEqual([join(storage, "in.png"), join(storage, "missing.png")]);
  });
});

describe("pages_create and pages_edit", () => {
  it("imports an allowed image on create, so the page keeps it after the file is gone", async () => {
    const { store, call } = setup();
    const source = join(storage, "chart.png");
    writeFileSync(source, PNG);
    const result = await call("pages_create", { title: "Report", markdown: `# Report\n\n![Chart](${source})\n` });
    expect(result).toContain("Created page");
    expect(result).not.toContain("not imported");
    const page = store.list({})[0]!;
    const markdown = store.get(page.id)!.markdown;
    expect(markdown).not.toContain(source);
    const [id] = fileIds(markdown);
    expect(id).toBeDefined();
    rmSync(source);
    expect(store.file(id!)).toMatchObject({ name: "chart.png", mime: "image/png" });
    expect(new Uint8Array(store.file(id!)!.data)).toEqual(PNG);
    expect(store.files(page.id)).toHaveLength(1);
  });

  it("imports from the workspace too, and leaves a disallowed or missing image as written, saying so", async () => {
    const { store, call } = setup();
    writeFileSync(join(workspace, "shot.png"), JPEG);
    writeFileSync(join(outside, "private.png"), PNG);
    const missing = join(storage, "never-made.png");
    const result = await call("pages_create", {
      title: "Mixed",
      markdown: `![a](${join(workspace, "shot.png")})\n\n![b](${join(outside, "private.png")})\n\n![c](${missing})\n`,
    });
    const page = store.list({})[0]!;
    const markdown = store.get(page.id)!.markdown;
    expect(fileIds(markdown)).toHaveLength(1);
    expect(markdown).toContain(join(outside, "private.png"));
    expect(markdown).toContain(missing);
    expect(result).toContain("2 images were not imported");
    expect(result).toContain(`${join(outside, "private.png")}: it is outside this thread's workspace and thread storage.`);
    expect(result).toContain(`${missing}: the file was not found.`);
    expect(result).toContain('::page{id="');
    expect(store.files(page.id)).toHaveLength(1);
  });

  it("imports on edit, and drops the copies when the edit fails", async () => {
    const { store, service, call } = setup();
    await call("pages_create", { title: "Notes", markdown: "Start\n" });
    const page = store.list({})[0]!;
    const source = join(storage, "later.webp");
    writeFileSync(source, WEBP);
    const edited = await call("pages_edit", { page: page.id, ops: [{ op: "append", markdown: `![Later](${source})` }] });
    expect(edited).toContain("Updated");
    // The live doc saves on a timer; read it the way pages_read does.
    const markdown = service.currentMarkdown(page.id)!;
    expect(markdown).not.toContain(source);
    expect(fileIds(markdown)).toEqual([store.files(page.id)[0]!.id]);
    expect(edited).not.toContain("not imported");
    expect(store.files(page.id)).toHaveLength(1);
    expect(store.files(page.id)[0]).toMatchObject({ name: "later.webp", mime: "image/webp" });

    const failed = await call("pages_edit", { page: page.id, ops: [{ op: "append", markdown: `![Again](${source})` }, { op: "delete", block: "nonexistent" }] });
    expect(failed).toContain("Edit failed");
    expect(store.files(page.id)).toHaveLength(1);
  });

  it("enforces the size and type limits on a real write", async () => {
    const { store, call } = setup();
    const big = join(storage, "big.png");
    writeFileSync(big, Buffer.concat([Buffer.from(PNG), Buffer.alloc(MAX_IMAGE_BYTES)]));
    const svg = join(storage, "logo.svg");
    writeFileSync(svg, "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");
    const result = await call("pages_create", { title: "Limits", markdown: `![](${big})\n\n![](${svg})\n` });
    expect(result).toContain(`${big}: it is larger than 10 MB.`);
    expect(result).toContain(`${svg}: SVG images aren't imported`);
    expect(store.files(store.list({})[0]!.id)).toHaveLength(0);
  });
});

describe("where the imported src renders", () => {
  it("survives the page's Markdown round trip, which the phone and the chat card read", async () => {
    const { store, service, call } = setup();
    const source = join(storage, "chart.png");
    writeFileSync(source, PNG);
    await call("pages_create", { title: "Report", markdown: `![Chart](${source})\n` });
    const page = store.list({})[0]!;
    const markdown = service.currentMarkdown(page.id)!;
    const [id] = fileIds(markdown);
    const src = `${PAGE_FILES_URL}?id=${id}`;
    expect(markdown).toContain(`![Chart](${src})`);
    // The full editor loads it as is.
    expect(pageImageUrl(page.id, src)).toBe(src);
    // Chat's renderer reads "/…" as a host path, so the card makes it absolute.
    expect(chatMarkdown(markdown, "http://127.0.0.1:4000")).toContain(`![Chart](http://127.0.0.1:4000${src})`);
  });

  it("chat card upgrades old page-file addresses and leaves other images alone", () => {
    expect(chatMarkdown("![a](/api/v1/plugins/pages/http/files?id=file_1) ![b](/tmp/b.png) ![c](https://x.invalid/c.png)", "http://h"))
      .toBe("![a](http://h/api/v1/plugins/studio/http/pages/files?id=file_1) ![b](/tmp/b.png) ![c](https://x.invalid/c.png)");
    expect(chatMarkdown("![a](/api/v1/x)")).toBe("![a](/api/v1/x)");
  });

  it("chat card shows an older page's local paths through the same scoped route as the editor", () => {
    expect(chatMarkdown("![b](</tmp/My Shots/b.png>) and `![c](/tmp/c.png)`\n```\n![d](/tmp/d.png)\n```", "http://h", "pg_a"))
      .toBe(`![b](http://h${PAGE_LOCAL_IMAGE_URL}?page=pg_a&path=%2Ftmp%2FMy%20Shots%2Fb.png) and \`![c](http://h${PAGE_LOCAL_IMAGE_URL}?page=pg_a&path=%2Ftmp%2Fc.png)\`\n\`\`\`\n![d](/tmp/d.png)\n\`\`\``);
  });
});

describe("older pages with local paths", () => {
  it("the full editor loads them through Studio's route", () => {
    expect(LOCAL_IMAGE_URL).toBe(PAGE_LOCAL_IMAGE_URL);
    expect(pageImageUrl("pg_a", "/tmp/My Shots/a.png")).toBe(`${PAGE_LOCAL_IMAGE_URL}?page=pg_a&path=%2Ftmp%2FMy%20Shots%2Fa.png`);
    expect(pageImageUrl("pg_a", "/api/v1/plugins/pages/http/files?id=file_1")).toBe(`${PAGE_FILES_URL}?id=file_1`);
  });

  it("serves an image the page names through a thread linked to the page, else a placeholder", async () => {
    const { sdk } = fakeSdk({ thr_other: { workspace: null, storage: join(dir, "other") }, thr_writer: { workspace, storage } });
    const source = join(storage, "old.png");
    writeFileSync(source, PNG);
    writeFileSync(join(outside, "secret.png"), PNG);
    const reader = (threadId: string) => threadImageReader({ sdk } as never, threadId);
    const markdown = `![Old](${source})\n\n![Secret](${join(outside, "secret.png")})\n`;
    const serve = (path: string, threads: string[], page: string | null = markdown) => pageLocalImage({ path, markdown: page, threads: () => threads, reader });

    const ok = await serve(source, ["thr_other", "thr_writer"]);
    expect(ok.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(PNG);

    const unavailable = async (response: Response) => {
      expect(response.headers.get("x-bb-image")).toBe("unavailable");
      expect(response.headers.get("content-type")).toBe("image/svg+xml");
      expect(await response.text()).toContain("Image not available");
    };
    // No linked thread can read it, the page doesn't name it, or there's no page.
    await unavailable(await serve(source, ["thr_other"]));
    await unavailable(await serve(join(outside, "secret.png"), ["thr_writer"]));
    await unavailable(await serve(join(storage, "unnamed.png"), ["thr_writer"]));
    await unavailable(await serve(source, ["thr_writer"], null));
    rmSync(source);
    await unavailable(await serve(source, ["thr_writer"]));
  });

  it("leaves pages a person writes alone", () => {
    const { service, store } = setup();
    const page = service.createPage({ projectId: null, parentId: null, title: "Mine", markdown: "![x](/tmp/x.png)\n", actor: HUMAN_USER_ID });
    expect(store.get(page.id)!.markdown).toContain("/tmp/x.png");
    expect(store.files(page.id)).toHaveLength(0);
  });
});
