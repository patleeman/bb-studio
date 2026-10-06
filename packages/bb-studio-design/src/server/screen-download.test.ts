import { describe, expect, it } from "vitest";
import { screenResponse } from "../../server";
import { screenDownloadUrl } from "../shared";

const screen = { id: "1a", html: "<!doctype html><body><p>Hi</p></body>" };

describe("Download HTML", () => {
  it("saves the screen as the agent wrote it, without the canvas script", async () => {
    const response = screenResponse(screen, true);
    expect(await response.text()).toBe(screen.html);
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="1a.html"');
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
  });

  it("asks the screen route for the download", () => {
    expect(new URL(screenDownloadUrl("dsn_0123456789abcdef", "1a", 5), "http://x").searchParams.get("download")).toBe("1");
  });

  it("still gives the canvas its script", async () => {
    expect(await screenResponse(screen, false).text()).toContain("data-bb-design-ui");
  });
});
