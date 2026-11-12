import { expect, it } from "vitest";
import { highlightParts, highlightRanges, queryParts } from "./search-match";

const marked = (text: string, query: string) => highlightParts(text, query).filter((part) => part.match).map((part) => part.text);

it("marks no stray letters: 'trees' marks nothing in a title that holds its letters scattered", () => {
  const title = "Fix review 1-3: voice reports, reaper…";
  expect(highlightRanges(title, "trees")).toEqual([]);
  expect(marked(title, "trees")).toEqual([]);
  expect(highlightParts(title, "trees")).toEqual([{ text: title, match: false }]);
});

it("marks the whole query anywhere, case-insensitive, even inside a word", () => {
  expect(marked("The report on the Port", "port")).toEqual(["port", "Port"]);
  expect(marked("Fix review 1-3: voice reports", "review 1-3")).toEqual(["review 1-3"]);
  // White space in the query matches any run of white space.
  expect(marked("offline\n  sync", "offline sync")).toEqual(["offline\n  sync"]);
});

it("marks a query word only where a word starts", () => {
  const title = "Fix review 1-3: voice reports, reaper";
  expect(marked(title, "voice rep")).toEqual(["voice rep"]);
  expect(marked(title, "rep voice")).toEqual(["voice", "rep"]);
  // "view" sits inside "review": not a word start, not the whole query typed.
  expect(marked(title, "view fix")).toEqual(["Fix"]);
  expect(marked("Design the system; redesign later", "system design")).toEqual(["Design", "system"]);
});

it("never marks a one-letter query or a one-letter query word on its own", () => {
  expect(highlightRanges("a cat and a hat", "a")).toEqual([]);
  expect(marked("a plan for a cat", "a plan")).toEqual(["a plan"]);
  expect(marked("the plan for a cat", "a plan")).toEqual(["plan"]);
});

it("joins overlapping pieces so ranges never overlap, and is safe with regex characters", () => {
  expect(highlightRanges("Ship offline sync", "offline sync")).toEqual([{ start: 5, end: 17 }]);
  expect(marked("Cost (USD) is $5.00", "$5.00")).toEqual(["$5.00"]);
  expect(marked("a+b and a.b", "a+b")).toEqual(["a+b"]);
  expect(highlightRanges("", "plan")).toEqual([]);
});

it("splits a query into its phrase and its words of two characters or more", () => {
  expect(queryParts("  Voice   rep  a ")).toEqual({ whole: "Voice rep a", words: ["voice", "rep"] });
  expect(queryParts("Rep rep")).toEqual({ whole: "Rep rep", words: ["rep"] });
});
