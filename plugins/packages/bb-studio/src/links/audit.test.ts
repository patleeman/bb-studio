import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TAB_KIND_REGISTRY, tabKindEntry } from "../tab-kinds";
import { LINK_AUDIT, LINK_AUDIT_SOURCES, linkAuditSources, linkAuditTable, linkSchemeTable, SAMPLE_REFS as SAMPLE } from "./audit";
import { directiveFor, linkFor, parseLink } from "./router";

describe("the link audit", () => {
  it("covers every registry kind and every link source, and each routed cell has a link that parses", () => {
    expect([...LINK_AUDIT.keys()]).toEqual(TAB_KIND_REGISTRY.map((entry) => entry.id));
    for (const [kind, cells] of LINK_AUDIT) {
      for (const source of LINK_AUDIT_SOURCES) {
        const cell = cells[source.id];
        if (cell !== "routes") continue;
        const ref = SAMPLE[kind];
        expect(parseLink(linkFor(ref), "http://127.0.0.1:1")?.type, `${kind} × ${source.id}`).toBe("entity");
        if (source.id === "card" && kind !== "conversation" && kind !== "todos") expect(directiveFor(ref), kind).not.toBeNull();
        if (source.id === "agent") expect(tabKindEntry(kind).agentType, kind).not.toBeNull();
      }
    }
    expect(LINK_AUDIT.get("terminal")!.transcript).not.toBe("routes");
    expect(LINK_AUDIT.get("page")!.design).not.toBe("routes");
  });

  it("keeps docs/link-audit.md to the table", () => {
    const doc = readFileSync(resolve(__dirname, "../../docs/link-audit.md"), "utf8");
    expect(doc).toContain(linkSchemeTable());
    expect(doc).toContain(linkAuditTable());
    expect(doc).toContain(linkAuditSources());
  });
});
