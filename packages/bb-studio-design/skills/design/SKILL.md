---
name: design
description: Use when the user asks you to design, prototype or mock up a UI — a screen, a flow, an app, a dashboard, a landing page — or refers to a Studio Design (a /plugins/design/designs/<id> link or an @design mention), or asks for another option, a revision or a change to one.
---

# Studio Design

A design is a set of rounds. Each round holds 2–3 options, and each option is
one self-contained HTML screen. The user sees them on a canvas, newest round
at the top, with each option's id badge (`1a`, `1b`, `2a`) and caption. They
refer to options by id in chat.

Tools: `design_create`, `design_read`, `design_write_screen`,
`design_edit_screen`, `design_list`, `design_comments`,
`design_resolve_comments`.

## Comments

The user can pin comments to elements of a screen. Ones they send to you
arrive as a message with the comment id, the screen, the element's selector
and markup, and the note. Make only the change the comment asks for, usually
with `design_edit_screen` on that element, then mark it done with
`design_resolve_comments`. When the user says "address the comments", read
the open ones with `design_comments` first.

## How to work

1. **Ask only what you can't find out.** Before a new design, check what you
   have: a design system or codebase in the project, references, a clear
   brief. Ask the user (briefly, in one round of questions) only when the
   answer would change what you build: the look is open and nothing defines
   it, or the brief leaves out the platform, the audience or which flows to
   cover. If the project has a design system and the brief is clear, start
   building and list the assumptions you made in your summary. Never ask about
   something the chat already settled. Don't ask for small follow-up edits.
2. **Read before you build.** Look at the project's design system, components
   and existing screens first. Match their colors, type, spacing, density,
   copy style and interaction patterns. Copy the assets you need into the
   screen rather than linking to the repo.
3. **State your system first.** Before writing HTML, say in one or two lines
   which fonts, colors and layout rhythm you're using. Then keep to them
   across every option in the round.
4. **Make a round of options.** Write 2–3 options with ids that share the
   round number (`1a`, `1b`, `1c`). Make them genuinely different in the
   dimension the user cares about (layout, flow, visual direction), ordered
   from safest to boldest. Give each a one-line caption saying what it tries.
   Set the round's title and a short intro saying how the options differ.
   For the next round, use the next number and leave earlier rounds as they
   are.
5. **Fight sameness.** Your first idea is everyone's first idea. When the look
   is open, pick a few decisions at random from small sets (for example, run
   a quick script to choose one of five type pairings and one of five accent
   hues), then design around what you drew.
6. **Keep small edits small.** For a request about one element, some text or
   a color, use `design_edit_screen` and change only that. Leave everything
   else exactly as it was. If a broader change would help, finish what was
   asked and suggest the rest.
7. **Send it for review.** When a round or a real change is ready, call
   `design_ready`. A separate reviewer checks the screens in the background
   and comes back to you only when something needs fixing; fix what it
   reports and call `design_ready` again. Until then the work is out for
   review, not done. Pass `skipReview` for trivial edits.
8. **Finish briefly.** End with a short summary: which options you added,
   assumptions, and caveats. No restating of what the user can see. Put the
   design's card, `::design{id="dsn_…"}`, on its own line in the reply: it
   opens the canvas in the user's workbench, beside this chat.

## Taste rules

- **No filler.** Every element earns its place. An empty-feeling section is a
  layout problem, not a reason to add content. Don't add stats, icons, badges
  or numbers the user didn't need. Ask before adding sections or pages they
  didn't request.
- **Keep the user's words.** Use text the user gives you word for word. When
  you write copy, write plainly and specifically for this product.
- **Avoid these defaults:** heavy gradient backgrounds; rounded cards with a
  colored left border; cards inside cards; decorative blobs and glows; emoji
  (unless the brand uses them); hand-drawn SVG illustrations; Inter, Roboto,
  Arial and Fraunces.
- **Color.** Use the design system's colors first. To extend a palette, use
  `oklch`. Tint whites and blacks only slightly. Use at most two accent
  colors, sharing lightness and chroma and differing in hue.
- **Type.** One to three readable fonts (system fonts or Google Fonts).
  Don't scale type with the viewport. Keep letter spacing at 0 unless the
  system says otherwise.
- **Images.** Don't draw pictures in SVG. Use a placeholder with subtle
  stripes and a short monospace label saying what goes there ("product
  photo", "map"), and ask the user for real images.
- **Layout.** Use flex or grid with `gap`. Use `text-wrap: pretty` for body
  text. Touch targets are at least 44px on mobile. Define `a` and `a:hover`
  colors from the palette. Make text fit its container at the frame's size.
- **Accessibility.** Real buttons and links, labeled inputs, visible focus
  states, and enough contrast to read.

## Writing screens

- Each screen is one complete HTML document: `<!doctype html>`, a viewport
  meta tag, inline `<style>` and `<script>`. External fonts, images and
  scripts may load over https. There's no shared file between screens, so
  repeat shared CSS in each.
- Pick the frame with `viewport`: `desktop` (1280×800), `tablet` (834×1112)
  or `mobile` (390×844). Design for that size; the canvas shows it there.
- Make prototypes work: real navigation between states, working form
  controls, and believable sample data that fits the product.
- **Flows: one prototype, splayed by step.** For a multi-step flow, write
  one screen that holds every step, so state carries through when the user
  plays it. Declare the steps in the head, in order:
  `<meta name="bb-design-steps" content="welcome=Welcome; address=Delivery address; done=All set">`.
  Each id must open the prototype at that step through the URL hash
  (`#address`): read `location.hash` on load and on `hashchange`. The
  canvas then shows one live frame per step side by side, and Play starts
  from any of them. Don't split a flow into one screen per step.
- Screens run sandboxed with no access to BB, cookies or storage beyond their
  own page. Don't rely on `localStorage` persisting.
