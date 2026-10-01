import { expect, it } from "vitest";
import { audioArchive } from "./audio-archive";

it("archives each audio segment in order", () => {
  const tar = audioArchive([{ name: "0001.m4a", bytes: new Uint8Array([1, 2, 3]) }, { name: "0002.m4a", bytes: new Uint8Array([4]) }]);
  const text = new TextDecoder().decode(tar);
  expect(text.slice(0, 8)).toBe("0001.m4a");
  expect([...tar.slice(512, 515)]).toEqual([1, 2, 3]);
  expect(text.slice(1024, 1032)).toBe("0002.m4a");
  expect([...tar.slice(1536, 1537)]).toEqual([4]);
  expect(tar.length).toBe(3072);
});
