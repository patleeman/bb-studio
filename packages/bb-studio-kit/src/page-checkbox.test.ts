import { describe, expect, it } from "vitest";
import { pageCheckboxes, setPageCheckbox } from "./page-checkbox";

describe("page task checkboxes", () => {
  it("finds linked and unlinked checkboxes by block id", () => {
    const rows = pageCheckboxes("<!-- ^abc12345 -->\n- [ ] Write copy\n<!-- ^def67890 -->\n- [x] Ship [Task](item:studio-tasks:tsk_1234567890abcdef)\n");
    expect(rows).toMatchObject([{ blockId: "abc12345", checked: false, title: "Write copy", taskId: null }, { blockId: "def67890", checked: true, title: "Ship", taskId: "tsk_1234567890abcdef" }]);
    expect(setPageCheckbox(rows[0]!.line, true)).toBe("- [x] Write copy");
  });
});
