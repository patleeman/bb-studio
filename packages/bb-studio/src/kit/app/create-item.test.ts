// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const { createStudioItem } = await import("./create-item");

afterEach(() => toast.error.mockReset());

it("opens an RPC-made item with the menu's opener", async () => {
  const open = vi.fn();
  await createStudioItem({ label: "Page", create: { mode: "rpc" } }, { projectId: "p1", addOn: "Pages", create: async () => "/plugins/pages/pages/pg_1", open });
  expect(open).toHaveBeenCalledWith("/plugins/pages/pages/pg_1");
});

it("hands an event kind the project and the same opener", async () => {
  const open = vi.fn();
  const create = vi.fn();
  const handler = (event: Event) => {
    event.preventDefault();
    const detail = (event as CustomEvent<{ projectId: string | null; opened(href: string): void }>).detail;
    expect(detail.projectId).toBe("p2");
    detail.opened("/plugins/talk/recordings/rec_1");
  };
  window.addEventListener("test:new", handler);
  await createStudioItem({ label: "Recording", create: { mode: "event", event: "test:new" } }, { projectId: "p2", addOn: "Talk", create, open });
  window.removeEventListener("test:new", handler);
  expect(create).not.toHaveBeenCalled();
  expect(open).toHaveBeenCalledWith("/plugins/talk/recordings/rec_1");
  expect(toast.error).not.toHaveBeenCalled();
});

it("says so when no add-on handles the event", async () => {
  await createStudioItem({ label: "Recording", create: { mode: "event", event: "test:nobody" } }, { projectId: null, addOn: "Talk", create: vi.fn() });
  expect(toast.error).toHaveBeenCalledWith("Talk isn't loaded yet. Reload BB and try again.");
});

it("reports a failed create", async () => {
  const open = vi.fn();
  await createStudioItem({ label: "Page", create: { mode: "rpc" } }, { projectId: null, addOn: "Pages", create: async () => { throw new Error("disk full"); }, open });
  expect(open).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledWith("Couldn't create a page: disk full");
});
