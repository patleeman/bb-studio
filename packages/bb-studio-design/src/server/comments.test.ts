import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { commentMessage } from "../../server";
import { withScreenScript } from "./screen-script";
import { DesignStore, MIGRATIONS } from "./store";

function memoryStore() {
  const db = new Database(":memory:");
  for (const statement of MIGRATIONS) db.exec(statement);
  return new DesignStore(db);
}

describe("design comments", () => {
  it("lists open comments in the design view, oldest first, and drops resolved ones", () => {
    const store = memoryStore();
    const row = store.create({ name: "Onboarding", by: "app" });
    store.writeScreen(row.id, { id: "1a", html: "<p>Hi</p>" }, "agent");
    const first = store.addComment(row.id, { screenId: "1a", selector: "body > p", elementHtml: "<p>Hi</p>", elementText: "Hi", body: "Warmer" });
    const second = store.addComment(row.id, { screenId: "1a", selector: "body > p", elementHtml: "<p>Hi</p>", elementText: "Hi", body: "Bigger" });
    store.setResolved(first.id, true);
    store.markSent(second.id);
    expect(store.view(row.id)!.comments).toEqual([expect.objectContaining({ id: second.id, body: "Bigger", sent: true })]);
    expect(store.comments(row.id, { includeResolved: true })).toHaveLength(2);
  });

  it("goes with its design", () => {
    const store = memoryStore();
    const row = store.create({ name: "", by: "app" });
    const comment = store.addComment(row.id, { screenId: "1a", selector: "body", elementHtml: "", elementText: "", body: "x" });
    store.delete(row.id);
    expect(store.comment(comment.id)).toBeNull();
  });

  it("tells the agent the note, the element and how to act on it", () => {
    const store = memoryStore();
    const row = store.create({ name: "Onboarding", by: "app" });
    const comment = store.addComment(row.id, { screenId: "1b", selector: "#cta", elementHtml: '<button id="cta">Go</button>', elementText: "Go", body: "Say Continue\nand make it green" });
    const message = commentMessage(row, comment);
    expect(message).toContain(`screen 1b of the design "Onboarding" (id ${row.id}, comment ${comment.id})`);
    expect(message).toContain("> Say Continue\n> and make it green");
    expect(message).toContain('```html\n<button id="cta">Go</button>\n```');
    expect(message).toContain("design_resolve_comments");
  });
});

describe("the screen script", () => {
  it("goes before </body>, or at the end without one", () => {
    expect(withScreenScript("<html><body><p>x</p></BODY></html>")).toMatch(/<p>x<\/p><style data-bb-design-ui>[\s\S]*<\/style><script data-bb-design-ui>[\s\S]*<\/script><\/BODY><\/html>$/);
    expect(withScreenScript("<p>x</p>")).toMatch(/^<p>x<\/p>\n<style data-bb-design-ui>@media print/);
  });

  it("is plain, parseable JavaScript", () => {
    const script = withScreenScript("").replace(/^\n<style data-bb-design-ui>[^<]*<\/style><script data-bb-design-ui>/, "").replace(/<\/script>$/, "");
    expect(() => new Function(script)).not.toThrow();
    expect(script).not.toMatch(/__name|require\(/);
  });
});

describe("prototype steps", () => {
  it("reads the steps a prototype declares, in order", async () => {
    const { parseSteps } = await import("../shared");
    const html = `<head><meta charset="utf-8"><meta content="welcome=Welcome; address = Delivery address ; done=All set=done" name='bb-design-steps'></head>`;
    expect(parseSteps(html)).toEqual([
      { id: "welcome", label: "Welcome" },
      { id: "address", label: "Delivery address" },
      { id: "done", label: "All set=done" },
    ]);
  });

  it("skips bad or repeated ids and screens without the tag", async () => {
    const { parseSteps } = await import("../shared");
    expect(parseSteps(`<meta name="bb-design-steps" content="a b=Bad; ok=Fine; ok=Again; =Empty">`)).toEqual([{ id: "ok", label: "Fine" }]);
    expect(parseSteps("<p>No steps</p>")).toEqual([]);
  });

  it("keeps the step a comment was pinned on", () => {
    const store = memoryStore();
    const row = store.create({ name: "", by: "app" });
    store.addComment(row.id, { screenId: "1a", step: "address", selector: "h1", elementHtml: "", elementText: "", body: "x" });
    expect(store.view(row.id)!.comments[0]).toMatchObject({ screenId: "1a", step: "address" });
  });
});
