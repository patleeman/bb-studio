// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@get-bb/plugin-sdk/app", () => ({
  experimental_Icon: ({ name }: { name: string }) => <i data-icon={name} />,
  useSdk: () => ({}),
}));
vi.mock("./pieces", () => ({ useProjects: () => [] }));

const { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } = await import("../ui/dropdown-menu");
const { MoveToSubmenu } = await import("./move-to");

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it("draws one chevron on Move to", async () => {
  await act(async () => root.render(
    <DropdownMenu open>
      <DropdownMenuTrigger>More</DropdownMenuTrigger>
      <DropdownMenuContent>
        <MoveToSubmenu items={[]} projects={[]} projectId={null} onProject={() => {}} />
      </DropdownMenuContent>
    </DropdownMenu>,
  ));
  const trigger = [...document.querySelectorAll('[role="menuitem"]')].find((element) => element.textContent?.includes("Move to"))!;
  expect(trigger.querySelectorAll('[data-icon="ChevronRight"]')).toHaveLength(1);
});
