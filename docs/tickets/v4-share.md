# v4 — Share

**Goal:** get a heatmap out of the app as an image worth posting, without
opening a hole in the security model to do it.

Q25 chose **download-only**. There are no public share links: reaching this data
without authentication would be the single such hole in the design, and it
deserves its own decision rather than arriving as a side effect of wanting a
pretty picture. The image is a file the user is handed. Where it goes next is
their business.

The risk in v4 is narrow but real: **an image that misrepresents the data**. A
number on screen is corrected by the next render, but a PNG is a claim that
outlives the app and travels without the context that would correct it. A Freeze
that renders like a Completion, or a rate quoted without its unit, is a lie the
user will unknowingly publish under their own name.

**Out of scope:** anything that uploads, hosts, or links.

---

## V4-1 · The canvas renderer ✅

A pure function from Habit + schedules + entries + a window to a canvas.

**It must not read the DOM.** No `getComputedStyle`, no measuring a mounted
grid, no cloning nodes. The rendered image is derived from the same rows and the
same rules as the on-screen grid, so the two cannot disagree — and it can be
produced for a habit that is not currently displayed.

Colours come from `palette.ts` directly, never from CSS custom properties. A CSS
variable resolves against whatever theme happens to be active on the element it
is read from, which makes the output depend on where in the tree the render
happened.

Three states must stay visually distinct in the file, exactly as they are in the
grid: gold, frozen, and unscheduled. Frozen is the one that matters — v3 made it
hollow precisely because a faded fill reads as a weaker Completion, and an image
that gets that wrong publishes a claim the user did not make.

Render at `devicePixelRatio` (floor 2) and scale the context, or the result is
a blurry image on every modern screen.

**Done when:** the same habit rendered to canvas and rendered to the DOM agree
cell for cell on state, and a habit with a Freeze in the window is
distinguishable from one with a Completion there.

**Result:** `src/lib/shareCard.ts`. 11 further tests, 185 passing overall.

**The two states cannot disagree because they are the same call.** The renderer
walks the same `buildGrid`/`buildMonthGrid` output and asks the same `cellState`
as the DOM heatmap. There is no second notion of what a Cell is.

**`cellPaint` was lifted out of the drawing so it could be asserted on.** Canvas
output is not testable without a headless canvas, but the *decision* that
produces it is — and that decision is where the misrepresentation risk actually
lives. Tests pin that a Freeze never shares a Completion's paint and that all
five states stay distinct. Both were mutation-checked: painting a Freeze as a
faded Completion breaks exactly those two tests.

Colours are literal values, not `getComputedStyle` reads. A CSS custom property
resolves against whatever theme is active on the element it is read from, which
would make the file depend on where in the tree the render happened.

## V4-2 · The share card ✅

The frame around the grid: habit name, the window it covers, and the figures
worth quoting — current streak, completion rate, flawless months.

**Every figure carries its unit.** R8's whole design is that a weekly-quota
habit is measured in weeks; "82%" with no unit is exactly the misleading number
v2 was built to avoid, and it is worse here because the image outlives the
screen. A rate with too little history behind it is omitted rather than rounded.

Light and dark are both offered, and the choice is explicit rather than
inherited. A dark card posted into a light thread is a choice someone should
make deliberately.

Long habit names are truncated rather than allowed to overflow the canvas.

**Done when:** the card states what window it covers, no figure appears without
its unit, and a habit too new to have a rate shows a card without one rather
than a card with "0%".

**Result:** `src/ShareCard.tsx`, opened from a Share link on each habit.

`cardFacts` is pure and tested for the same reason `cellPaint` is. A
weekly-quota habit's figures come out in weeks, a rate with no opportunities
behind it is omitted rather than printed as 0%, and a streak of zero is left out
entirely. Printing 0% instead of omitting breaks exactly that test.

The preview is the real renderer rather than a mock, so what is on screen is
what lands in the downloads folder. The card's theme is seeded from the app's
but chosen separately — a dark card posted into a light thread should be a
deliberate act.

## V4-3 · Download, and the close-out ✅

The download itself — same blob-and-anchor path as the V2-5 export, since it is
the same problem — plus the project's closing pass.

A README: what this is, how to run it, where the design lives. The repo has
`CONTEXT.md`, four ADRs, the rules, the data model, four ticket files and a
runbook, and no front door to any of it.

**Done when:** a PNG lands in the downloads folder from a phone and from a
desktop browser, and someone who has never seen the repo can find the design
reasoning from the README in one hop.

**Result:** `README.md`, and the same blob-and-anchor download the V2-5 export
uses.

The image is re-rendered at download rather than read off the preview element,
which the browser is free to have resized or detached in between.

The README is a front door to work that was mostly written before the code: the
glossary, the eight derivation rules, four ADRs, the data model, and four ticket
files whose Results record what actually went wrong. Every link was checked to
resolve.

**Not verified by me:** that a PNG actually lands in a downloads folder. That
needs a real browser on a real device, and it is the one claim in this ticket I
am taking on the strength of the export path already working the same way.
