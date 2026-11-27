// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { PluginSettingsForm } from "./PluginSettings";

const SHOWN =
  "http://127.0.0.1:38886/api/v1/plugins/mobile/http/push?token=[redacted …EN42]";

function view(relayUrl: string) {
  return {
    ok: true,
    schema: {
      expoPushUrl: { type: "string", label: "Expo push relay URL" },
      note: { type: "string", label: "Note" },
    },
    values: { expoPushUrl: relayUrl, note: "hello" },
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("a redacted string setting (fork)", () => {
  it("shows the redacted value as text with Replace; only Save or Enter saves, and Escape or leaving the field cancels", async () => {
    const puts: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "PUT") {
          const body = JSON.parse(String(init.body)) as {
            values: Record<string, unknown>;
          };
          puts.push(body.values);
          return new Response(
            JSON.stringify(
              view("http://127.0.0.1:38887/push?token=[redacted …WXYZ]"),
            ),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(JSON.stringify(view(SHOWN)), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const { wrapper } = createQueryClientTestHarness();
    render(<PluginSettingsForm pluginId="push-notifications" />, { wrapper });

    expect(
      (await screen.findByTestId("redacted-setting-expoPushUrl")).textContent,
    ).toBe(SHOWN);
    expect(screen.queryByLabelText("Expo push relay URL")).toBeNull();
    expect((screen.getByLabelText("Note") as HTMLInputElement).value).toBe(
      "hello",
    );

    const replace = () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Replace Expo push relay URL" }),
      );
      return screen.getByLabelText("Expo push relay URL") as HTMLInputElement;
    };
    const typed =
      "http://127.0.0.1:38887/push?token=abcdefghijklmnopqrstuvWXYZ";

    const field = replace();
    expect(field.value).toBe("");
    expect(
      (screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.change(field, { target: { value: typed } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.getByTestId("redacted-setting-expoPushUrl").textContent).toBe(
      SHOWN,
    );

    const half = replace();
    fireEvent.change(half, { target: { value: "http://127.0.0.1:3" } });
    fireEvent.blur(half, { relatedTarget: document.body });
    expect(screen.getByTestId("redacted-setting-expoPushUrl").textContent).toBe(
      SHOWN,
    );
    expect(puts).toEqual([]);

    const again = replace();
    fireEvent.change(again, { target: { value: typed } });
    const save = screen.getByRole("button", { name: "Save" });
    fireEvent.blur(again, { relatedTarget: save });
    fireEvent.click(save);
    await waitFor(() =>
      expect(
        screen.getByTestId("redacted-setting-expoPushUrl").textContent,
      ).toBe("http://127.0.0.1:38887/push?token=[redacted …WXYZ]"),
    );
    expect(puts).toEqual([{ expoPushUrl: typed }]);

    const byEnter = replace();
    fireEvent.change(byEnter, { target: { value: typed } });
    fireEvent.keyDown(byEnter, { key: "Enter" });
    await waitFor(() => expect(puts).toHaveLength(2));
  });
});
