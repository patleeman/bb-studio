// @vitest-environment jsdom
import { expect, it } from "vitest";
import { leavesFullSize } from "./whiteboard-expand";

it("leaves full size on an Esc the editor didn't use", () => {
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  expect(leavesFullSize({ key: "Escape", defaultPrevented: false, target: canvas })).toBe(true);
  expect(leavesFullSize({ key: "Escape", defaultPrevented: true, target: canvas })).toBe(false);
  expect(leavesFullSize({ key: "Enter", defaultPrevented: false, target: canvas })).toBe(false);
  // Typing a label, or a menu or dialog the editor opened, keeps its Esc.
  for (const html of ["<textarea></textarea>", "<input>", "<div role=\"menu\"><button></button></div>", "<div role=\"dialog\"><button></button></div>"]) {
    const box = document.createElement("div");
    box.innerHTML = html;
    document.body.append(box);
    const target = box.querySelector("button, textarea, input")!;
    expect(leavesFullSize({ key: "Escape", defaultPrevented: false, target })).toBe(false);
  }
});
