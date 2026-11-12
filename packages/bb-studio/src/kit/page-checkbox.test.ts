import { describe, expect, it } from "vitest";
import { pageCheckboxes } from "./page-checkbox";

describe("page checkboxes", () => {
  it("finds checkboxes by block id", () => {
    const rows = pageCheckboxes("<!-- ^abc12345 -->\n- [ ] Write copy\n<!-- ^def67890 -->\n- [x] Ship\n");
    expect(rows).toMatchObject([{ blockId: "abc12345", checked: false, title: "Write copy" }, { blockId: "def67890", checked: true, title: "Ship" }]);
  });
});
