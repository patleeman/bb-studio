import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it } from "vitest";
import plugin from "../../server";
import { SANDBOX_CSP } from "./content";

const hosts: ReturnType<typeof createFakePluginHost>[] = [];
afterEach(async () => { for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose(); });
async function fixture() {
  const host = createFakePluginHost({ pluginId: "artifacts" });
  hosts.push(host);
  await plugin(host.bb);
  const rpc = host.harness.behavior;
  return {
    ...host, rpc,
    async save(name: string, mime: string, bytes: Buffer) {
      const { id } = await rpc.callRpc("importFile", { name, mime, bytes: bytes.toString("base64"), projectId: null }) as { id: string };
      const { artifact } = await rpc.callRpc("get", { id }) as { artifact: { version: { id: string; name: string; mime: string; type: string } } };
      return { id, version: artifact.version, url: `/content?artifact=${id}&version=${artifact.version.id}` };
    },
  };
}

it.each([
  ["report.md", "application/octet-stream", "# Report\n\n雪", "markdown", "text/plain; charset=utf-8"],
  ["notes.txt", "text/html", "<h1>literal</h1>", "text", "text/plain; charset=utf-8"],
  ["data.json", "text/plain", '{"ok":true}', "code", "text/plain; charset=utf-8"],
  ["report.html", "application/octet-stream", "<html><body><h1>Report</h1></body></html>", "html", "text/html; charset=utf-8"],
  ["drawing.svg", "image/svg+xml", '<svg xmlns="http://www.w3.org/2000/svg"/>', "image", "image/svg+xml"],
  ["unknown.bin", "text/html", "<h1>MIME-selected HTML</h1>", "html", "text/html; charset=utf-8"],
  ["archive.zip", "application/zip", "PK-test", "other", "application/octet-stream"],
  ["unknown.bin", "text/html\r\nx-injected: true", "<h1>Untrusted MIME</h1>", "other", "application/octet-stream"],
])("serves %s with its declared preview type and isolated original bytes", async (name, mime, source, type, servedMime) => {
  const host = await fixture();
  const saved = await host.save(name, mime, Buffer.from(source));
  expect(saved.version.type).toBe(type);
  const response = await host.rpc.fetchHttp("GET", saved.url);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe(servedMime);
  expect(response.headers.get("content-security-policy")).toBe(SANDBOX_CSP);
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(await response.text()).toBe(source);
  const text = await host.rpc.callRpc("text", { id: saved.id, versionId: saved.version.id });
  expect(text).toEqual({ text: type === "image" || type === "other" ? null : source, truncated: false });
  const download = await host.rpc.fetchHttp("GET", `${saved.url}&download=1`);
  expect(download.headers.get("content-disposition")).toContain("attachment;");
  expect(Buffer.from(await download.arrayBuffer())).toEqual(Buffer.from(source));
});

it("keeps HTML quote instrumentation out of original downloads", async () => {
  const host = await fixture();
  const source = "<html><body><p>Quote me</p></body></html>";
  const saved = await host.save("quote.html", "text/html", Buffer.from(source));
  const preview = await host.rpc.fetchHttp("GET", `${saved.url}&quote=1`);
  expect(await preview.text()).toContain("bb-artifact-selection");
  expect(preview.headers.get("content-security-policy")).toBe(SANDBOX_CSP);
  expect(await (await host.rpc.fetchHttp("GET", `${saved.url}&download=1`)).text()).toBe(source);
});

it("serves binary image bytes and distinguishes PDF signatures from disguised HTML", async () => {
  const host = await fixture();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=", "base64");
  const image = await host.save("one.png", "application/octet-stream", png);
  const response = await host.rpc.fetchHttp("GET", image.url);
  expect(response.headers.get("content-type")).toBe("image/png");
  expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
  for (const [source, mime, sandbox] of [["%PDF-1.7\n%%EOF", "application/pdf", null], ["<script>parent.x=1</script>", "application/octet-stream", SANDBOX_CSP]] as const) {
    const saved = await host.save("document.pdf", "application/pdf", Buffer.from(source));
    const response = await host.rpc.fetchHttp("GET", saved.url);
    expect(response.headers.get("content-type")).toBe(mime);
    expect(response.headers.get("content-security-policy")).toBe(sandbox);
    expect(await response.text()).toBe(source);
  }
});

it("normalizes filenames and rejects invalid imports without creating artifacts", async () => {
  const host = await fixture();
  const saved = await host.save('C:\\folder\\rapport "été".txt', "text/plain", Buffer.from(""));
  expect(saved.version.name).toBe('rapport "été".txt');
  const response = await host.rpc.fetchHttp("GET", `${saved.url}&download=1`);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-disposition")).toContain("filename*=UTF-8''rapport%20%22%C3%A9t%C3%A9%22.txt");
  expect(await response.text()).toBe("");
  const before = await host.rpc.callRpc("studio_list", null);
  for (const [name, bytes] of [["..", ""], ["bad.txt", "%%%="], ["bad.txt", "YQ"]]) {
    await expect(host.rpc.callRpc("importFile", { name, mime: "text/plain", bytes, projectId: null })).rejects.toThrow();
  }
  expect(await host.rpc.callRpc("studio_list", null)).toEqual(before);
});

it("isolates version ownership and returns clear missing/deleted/blob-missing responses", async () => {
  const host = await fixture();
  const a = await host.save("a.txt", "text/plain", Buffer.from("A"));
  const b = await host.save("b.txt", "text/plain", Buffer.from("B"));
  expect((await host.rpc.fetchHttp("GET", `/content?artifact=${a.id}&version=${b.version.id}`)).status).toBe(404);
  expect((await host.rpc.fetchHttp("GET", "/content")).status).toBe(404);
  await expect(host.rpc.callRpc("text", { id: a.id, versionId: b.version.id })).rejects.toThrow(/Version not found/);
  host.bb.storage.database().prepare("DELETE FROM artifact_blobs").run();
  expect((await host.rpc.fetchHttp("GET", a.url)).status).toBe(404);
  expect(await host.rpc.callRpc("text", { id: a.id, versionId: a.version.id })).toEqual({ text: null, truncated: false });
  await host.rpc.callRpc("delete", { id: a.id });
  expect(await host.rpc.callRpc("get", { id: a.id })).toEqual({ artifact: null, versions: [] });
});

it("marks the 2 MiB text preview truncated while downloads retain all bytes", async () => {
  const host = await fixture();
  const bytes = Buffer.from("x".repeat(2 * 1024 * 1024) + "final suffix");
  const saved = await host.save("large.txt", "text/plain", bytes);
  const result = await host.rpc.callRpc("text", { id: saved.id, versionId: saved.version.id }) as { text: string; truncated: boolean };
  expect(result.truncated).toBe(true);
  expect(result.text).toHaveLength(2 * 1024 * 1024);
  expect(Buffer.from(await (await host.rpc.fetchHttp("GET", `${saved.url}&download=1`)).arrayBuffer())).toEqual(bytes);
});
