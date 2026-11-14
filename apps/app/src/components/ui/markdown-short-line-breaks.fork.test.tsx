// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./markdown-preview";
import {
  keepsShortLineBreaks,
  looksHardWrapped,
  withShortLineBreaks,
} from "./markdown-short-line-breaks.fork";

vi.mock("@/lib/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sdk")>();
  return {
    ...actual,
    sdk: {
      ...actual.sdk,
      threads: { ...actual.sdk.threads, resolveMentions: vi.fn(async () => []) },
    },
  };
});

afterEach(() => cleanup());

const POEM = [
  "The tide comes in at dusk,",
  "grey water over stone,",
  "a gull above the harbour",
  "calls out and is alone.",
  "The lamps come on one by one,",
  "and the sea goes on.",
].join("\n");

const WRAPPED = [
  "This paragraph was hard-wrapped by a model at about seventy-two columns so",
  "that it reads well in a terminal, but in the app it should flow as one",
  "paragraph without a break at the end of each line.",
].join("\n");

const ASSISTANT = withShortLineBreaks({ mentions: [], preserveSoftBreaks: false });

function paragraphs(container: HTMLElement) {
  return [...container.querySelectorAll("p")];
}

describe("assistant messages keep short line breaks", () => {
  it("marks only the options it was given", () => {
    expect(keepsShortLineBreaks(ASSISTANT)).toBe(true);
    expect(keepsShortLineBreaks({ mentions: [], preserveSoftBreaks: false })).toBe(false);
    expect(keepsShortLineBreaks(undefined)).toBe(false);
  });

  it("tells a poem from hard-wrapped prose", () => {
    expect(looksHardWrapped(POEM)).toBe(false);
    expect(looksHardWrapped(WRAPPED)).toBe(true);
    expect(looksHardWrapped("one line")).toBe(false);
  });

  it("renders a six-line poem as six lines in one paragraph", () => {
    const { container } = render(
      <MarkdownPreview content={POEM} threadMentions={ASSISTANT} />,
    );
    const [poem] = paragraphs(container);
    expect(paragraphs(container)).toHaveLength(1);
    expect(poem?.querySelectorAll("br")).toHaveLength(5);
  });

  it("keeps breaks inside emphasis and links", () => {
    const { container } = render(
      <MarkdownPreview
        content={"**Sat Nov 14**\nCall the dentist\n_bring the card_\nthen lunch"}
        threadMentions={ASSISTANT}
      />,
    );
    expect(container.querySelectorAll("p br")).toHaveLength(3);
  });

  it("lets hard-wrapped prose flow and keeps blank-line paragraphs apart", () => {
    const { container } = render(
      <MarkdownPreview
        content={`${WRAPPED}\n\nSecond paragraph.`}
        threadMentions={ASSISTANT}
      />,
    );
    expect(paragraphs(container)).toHaveLength(2);
    expect(container.querySelectorAll("br")).toHaveLength(0);
  });

  it("leaves lists, headings and code blocks alone", () => {
    const { container } = render(
      <MarkdownPreview
        content={"## Plan\n- one\n- two\n\n```\na\nb\n```"}
        threadMentions={ASSISTANT}
      />,
    );
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelectorAll("br")).toHaveLength(0);
    expect(container.querySelector("pre")?.textContent).toContain("a\nb");
  });

  it("keeps bb's behavior for other markdown that does not opt in", () => {
    const { container } = render(
      <MarkdownPreview
        content={POEM}
        threadMentions={{ mentions: [], preserveSoftBreaks: false }}
      />,
    );
    expect(container.querySelectorAll("br")).toHaveLength(0);
  });

  it("keeps user messages' line breaks as bb does", () => {
    const { container } = render(
      <MarkdownPreview
        content={WRAPPED}
        threadMentions={{ mentions: [], preserveSoftBreaks: true }}
      />,
    );
    expect(container.querySelectorAll("br")).toHaveLength(2);
  });
});
