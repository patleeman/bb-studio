import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLocalViewUrl } from "../src/local-view.js";

const PREFIX = "data:text/html;charset=utf-8,";

describe("BB Studio's local desktop views", () => {
  it("titles the loading window BB Studio", () => {
    const url = createLocalViewUrl({
      viewModel: {
        kind: "loading",
        message: "Starting local services and opening BB Studio.",
        title: "Opening BB Studio",
      },
    });
    const html = decodeURIComponent(url.slice(PREFIX.length));
    expect(html).toContain("<title>BB Studio</title>");
    expect(html).not.toContain("<title>bb</title>");
  });

  it("opens the loading view as BB Studio", () => {
    const main = readFileSync(join(__dirname, "../src/main.ts"), "utf8");
    expect(main).toContain('title: "Opening BB Studio"');
    expect(main).toContain(
      'message: "Starting local services and opening BB Studio."',
    );
  });
});
