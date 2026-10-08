import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { backupFileName, registerBackup } from "./register";
import type { BackupService } from "./service";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "studio-register-"));
  dirs.push(dir);
  const handlers: Record<string, (input: never) => Promise<unknown>> = {};
  const routes: Record<string, (context: unknown) => Promise<Response>> = {};
  const outcome = { failed: false };
  const restore = vi.fn(async (_file: string, options: { dryRun: boolean }) => ({
    dryRun: options.dryRun, createdAt: "2026-10-07", projects: { mapped: 0, unmapped: [] },
    sections: outcome.failed ? [{ pluginId: "pages", name: "Pages", status: "failed" as const, reason: "boom", report: null }] : [],
  }));
  const service = { cleanup: async () => {}, restore, backup: vi.fn() } as unknown as BackupService;
  registerBackup({
    rpc: { register: (_contract: unknown, registered: typeof handlers) => Object.assign(handlers, registered) },
    http: { route: (_method: string, path: string, handler: (context: unknown) => Promise<Response>) => { routes[path] = handler; } },
    log: { warn: () => {} },
    onDispose: () => {},
  } as never, service, dir);
  const call = <T>(method: string, input: unknown) => handlers[method]!(input as never) as Promise<T>;
  return { dir, call, restore, routes, outcome };
}

it("takes an upload in ordered chunks, accepts a repeated chunk once and refuses gaps", async () => {
  const { dir, call, restore } = await setup();
  const first = await call<{ uploadId: string; received: number }>("backup.upload", { uploadId: null, offset: 0, data: Buffer.from("abc").toString("base64") });
  expect(first.received).toBe(3);
  await call("backup.upload", { uploadId: first.uploadId, offset: 3, data: Buffer.from("def").toString("base64") });
  expect(await call("backup.upload", { uploadId: first.uploadId, offset: 3, data: Buffer.from("def").toString("base64") })).toMatchObject({ received: 6 });
  await expect(call("backup.upload", { uploadId: first.uploadId, offset: 10, data: "eA==" })).rejects.toThrow(/out of order/);
  const path = join(dir, "backup-uploads", `${first.uploadId}.zip`);
  expect(await readFile(path, "utf8")).toBe("abcdef");

  expect(await call("backup.restore", { uploadId: first.uploadId, dryRun: true })).toMatchObject({ dryRun: true, failed: false });
  expect(restore).toHaveBeenLastCalledWith(path, { dryRun: true });
  expect((await stat(path)).size).toBe(6);
  await call("backup.restore", { uploadId: first.uploadId, dryRun: false });
  await expect(stat(path)).rejects.toThrow();
  await expect(call("backup.upload", { uploadId: first.uploadId, offset: 6, data: "eA==" })).rejects.toThrow(/no longer exists/);
});

it("serves only backup files by their generated names", async () => {
  const { routes } = await setup();
  const context = (name: string) => ({ req: { query: () => name }, text: (body: string, status: number) => new Response(body, { status }) });
  expect((await routes["/backup"]!(context("../data.db"))).status).toBe(404);
  expect((await routes["/backup"]!(context(backupFileName(new Date(0))))).status).toBe(404);
  expect(backupFileName(new Date(0), 0)).toBe("bb-studio-backup-1970-01-01T00-00-00-000-0000.zip");
  expect(backupFileName(new Date(0), 42)).not.toBe(backupFileName(new Date(0), 43));
  expect(backupFileName()).toMatch(/^bb-studio-backup-[0-9T-]+\.zip$/);
});

const b64 = (text: string) => Buffer.from(text).toString("base64");

it("never returns an upload id for an empty chunk", async () => {
  const { dir, call } = await setup();
  await expect(call("backup.upload", { uploadId: null, offset: 0, data: "" })).rejects.toThrow(/empty/);
  await expect(stat(join(dir, "backup-uploads"))).rejects.toThrow();
});

it("restores only the file the dry run showed", async () => {
  const { call, restore } = await setup();
  const { uploadId } = await call<{ uploadId: string }>("backup.upload", { uploadId: null, offset: 0, data: b64("abc") });
  await expect(call("backup.restore", { uploadId, dryRun: false })).rejects.toThrow(/Check this file first/);
  await call("backup.restore", { uploadId, dryRun: true });
  await call("backup.upload", { uploadId, offset: 3, data: b64("def") });
  await expect(call("backup.restore", { uploadId, dryRun: false })).rejects.toThrow(/Check this file first/);
  expect(restore).toHaveBeenCalledTimes(1);
  await call("backup.restore", { uploadId, dryRun: true });
  await call("backup.restore", { uploadId, dryRun: false });
  expect(restore).toHaveBeenCalledTimes(3);
});

it("keeps the uploaded file after a restore with failures, so it can run again", async () => {
  const { dir, call, outcome } = await setup();
  const { uploadId } = await call<{ uploadId: string }>("backup.upload", { uploadId: null, offset: 0, data: b64("abc") });
  const path = join(dir, "backup-uploads", `${uploadId}.zip`);
  await call("backup.restore", { uploadId, dryRun: true });
  outcome.failed = true;
  expect(await call("backup.restore", { uploadId, dryRun: false })).toMatchObject({ failed: true });
  expect((await stat(path)).size).toBe(3);
  outcome.failed = false;
  expect(await call("backup.restore", { uploadId, dryRun: false })).toMatchObject({ failed: false });
  await expect(stat(path)).rejects.toThrow();
});
