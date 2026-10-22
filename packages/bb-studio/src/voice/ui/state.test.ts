// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
const { play } = vi.hoisted(() => ({ play: vi.fn(async () => {}) }));
vi.mock("../../speech/speaker", () => ({ Speaker: class { play = play; stop() {} } }));
vi.mock("./read-along", () => ({ clearHighlight() {}, highlightPiece() {} }));
import { voicePlayer } from "./state";

it("deduplicates events while allowing identical audio from distinct turns and threads", async () => {
  await voicePlayer.play("a", ["same"], [], "turn1");
  await voicePlayer.play("a", ["same"], [], "turn1");
  await voicePlayer.play("a", ["same"], [], "turn2");
  await voicePlayer.play("b", ["same"], [], "turn1");
  expect(play).toHaveBeenCalledTimes(3);
});

it("lets a failed event play again", async () => {
  play.mockClear();
  play.mockRejectedValueOnce(new Error("audio failed"));
  await expect(voicePlayer.play("a", ["same"], [], "retry")).rejects.toThrow("audio failed");
  await voicePlayer.play("a", ["same"], [], "retry");
  expect(play).toHaveBeenCalledTimes(2);
});
