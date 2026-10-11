import { describe, expect, it } from "vitest";
import { createEditGate } from "./edit-gate";

describe("the canvas text edit gate", () => {
  it("takes the edit the user started, once", () => {
    const gate = createEditGate();
    gate.start("1a", "Hello", { editing: true, activated: true });
    expect(gate.take("1a", "Hello", true)).toBe(true);
    expect(gate.take("1a", "Hello", true)).toBe(false);
  });

  it("refuses edits a screen's script posts on its own", () => {
    const gate = createEditGate();
    // Never started, or started without a user click.
    expect(gate.take("1a", "Hello", true)).toBe(false);
    gate.start("1a", "Hello", { editing: true, activated: false });
    expect(gate.take("1a", "Hello", true)).toBe(false);
    // Outside Edit mode.
    gate.start("1a", "Hello", { editing: false, activated: true });
    expect(gate.take("1a", "Hello", false)).toBe(false);
    gate.start("1a", "Hello", { editing: true, activated: true });
    expect(gate.take("1a", "Hello", false)).toBe(false);
  });

  it("refuses another frame or another element", () => {
    const gate = createEditGate();
    gate.start("1a", "Hello", { editing: true, activated: true });
    expect(gate.take("1b", "Hello", true)).toBe(false);
    expect(gate.take("1a", "Other text", true)).toBe(false);
    // A forged attempt on the right frame drops the open edit.
    expect(gate.take("1a", "Hello", true)).toBe(false);
  });

  it("forgets an edit when Edit mode ends", () => {
    const gate = createEditGate();
    gate.start("1a", "Hello", { editing: true, activated: true });
    gate.reset();
    expect(gate.take("1a", "Hello", true)).toBe(false);
  });
});
