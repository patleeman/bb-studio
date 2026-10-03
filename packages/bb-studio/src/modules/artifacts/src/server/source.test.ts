import { describe, expect, it } from "vitest";
import { displayPath, resolveSource, type SourceRoot } from "./source";

const workspace: SourceRoot = { kind: "workspace", hostId: "h", path: "/work/repo" };
const storage: SourceRoot = { kind: "storage", hostId: "h", path: "/data/thread-storage/thr_1" };
const roots = [workspace, storage];

describe("resolveSource", () => {
  it("resolves relative paths from the workspace", () => {
    expect(resolveSource("out/chart.png", roots)).toEqual({ root: workspace, path: "/work/repo/out/chart.png" });
  });

  it("resolves relative paths from a cwd inside a root", () => {
    expect(resolveSource("chart.png", roots, "/work/repo/out")).toMatchObject({ path: "/work/repo/out/chart.png" });
    expect(resolveSource("chart.png", roots, "/tmp")).toMatchObject({ path: "/work/repo/chart.png" });
  });

  it("accepts absolute paths in either root", () => {
    expect(resolveSource("/data/thread-storage/thr_1/a.html", roots)).toEqual({ root: storage, path: "/data/thread-storage/thr_1/a.html" });
  });

  it("refuses paths that leave the roots", () => {
    for (const path of ["../secret", "/etc/passwd", "/work/repo-other/x", "out/../../x", "~/notes.md"]) {
      expect(resolveSource(path, roots)).toHaveProperty("error");
    }
  });

  it("refuses empty paths, NUL bytes, a root itself and a thread with no roots", () => {
    expect(resolveSource("  ", roots)).toHaveProperty("error");
    expect(resolveSource("a\0b", roots)).toHaveProperty("error");
    expect(resolveSource("/work/repo/", roots)).toHaveProperty("error");
    expect(resolveSource("a.txt", [])).toHaveProperty("error");
  });

  it("prefers the most specific root", () => {
    const nested: SourceRoot = { kind: "storage", hostId: "h", path: "/work/repo/.bb/storage" };
    expect(resolveSource("/work/repo/.bb/storage/x.md", [workspace, nested])).toMatchObject({ root: nested });
  });
});

describe("displayPath", () => {
  it("shows paths relative to their root", () => {
    expect(displayPath({ root: workspace, path: "/work/repo/out/a.png" })).toBe("out/a.png");
    expect(displayPath({ root: storage, path: "/data/thread-storage/thr_1/a.png" })).toBe("thread-storage/a.png");
  });
});
