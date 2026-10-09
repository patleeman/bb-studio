import { describe, expect, it } from "vitest";
import { fileTree } from "./SpaceFiles";

describe("fileTree", () => {
  it("nests files under their folders", () => {
    const root = fileTree(["README.md", "src/a.ts", "src/ui/b.tsx"]);
    expect(root.files).toEqual(["README.md"]);
    const src = root.folders.get("src")!;
    expect(src.path).toBe("src");
    expect(src.files).toEqual(["src/a.ts"]);
    expect(src.folders.get("ui")!.files).toEqual(["src/ui/b.tsx"]);
  });
});
