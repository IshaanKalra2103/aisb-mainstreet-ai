# Guided tour of the example shops, and previews that show the tool working

Date: 2026-11-17 (finals tonight, 7:00 pm ET). Status: short design, waiting for Ishaan's approval.

## Why

- People opening an example page don't know where to look or in what order. Ishaan wants a tutorial mode that walks
  them through the flow with highlights, with the run that produced each step shown alongside.
- Today's previews are one generic Veo shot per tool ("owner busy, a tablet on the counter answers a question"). Veo
  can't draw readable screens, so the clip never shows the tool doing its job. Ishaan wants clips specific to how the
  tool works inside that business, still made with OpenRouter video.

## Goals, non-goals, anti-goals

- Goals: a guided tour on the five example pages; each step replays the part of the example's saved run that made it;
  every new preview shows the tool's actual screen with the shop's real words, animated by Veo through OpenRouter.
- Non-goals: a tour on live owner pages, new example shops, changes to intake, needs, compare or setup, and iMessage
  changes (the preview already arrives there as its own video card).
- Anti-goals: a tour that traps the page (X and Esc always close it); invented prices, hours or claims in a clip; a
  broken demo at 7 pm. Code freezes about 5:30 pm; if a new clip looks wrong, the example keeps its current clip.

## Constraints

- About 4 hours. Shared working tree. Nothing is committed or deployed without Ishaan's OK; one combined ship.
- The OpenRouter key has a $25 limit. A clip is 6 s at $0.05/s, about $0.30.
- Phone width with a 16 px gutter, the projector, and reduced motion must all work.

## Approaches

Videos (picked first: A; revised to A+B, see Previews below)

- A. Real screens, animated by Veo. The agent draws the tool's screen as HTML with the shop's real words, renders a
  before and an after frame, and Veo animates between them. Builds on the frames pipeline that shipped in dcdc705
  (`preview frames`, `preview make --first --last`). Words are exact at both ends; Veo may blur them mid-motion.
- B. Two shots stitched: Veo animates the shop's photo, then a screen recording of the tool. Fully legible, but the
  sandbox has no ffmpeg or screen recording today. Too much to build and test before 7 pm.
- C. Only better prompts. Cheapest, but the tool is still never seen working, which was the complaint.

Tour (picked: 1)

- 1. A guided tour on the example pages themselves, with a replay of the run in each step. Needs only markers and one
  mount line in BusinessView.
- 2. A separate tour page of step cards with recordings. No BusinessView changes, but it is a slideshow beside the
  product, not the product.

## Design

### Tour

- New `web/components/Tour.tsx` and `web/data/demo/tours.ts` (one script per example: steps, each with a target,
  a one- or two-line note on what to look at, an optional action, and the run excerpt for that step).
- Starts from a "Take the tour" button on example pages only, or with `?tour=1` so the projector can open straight
  into it. Next and Back buttons, arrow keys, "step 3 of 7", X and Esc to close.
- Each step scrolls its target into view, dims the rest of the page around a cutout, and shows a note card: beside
  the target on wide screens, docked at the bottom on phones.
- Steps: (1) what we read: the facts, each linked to its source; (2) the jobs and hours back; (3) the top job's card;
  (4) compare and "Why this score": six checks, 75 or more plus a person's sign-off is Verified; (5) the preview
  clip; (6) Set it up or Not now: nothing happens until the owner says yes; (7) the setup replay.
- Steps that need a sheet (compare, preview) click the element marked for that action and close the sheet when the
  step is left. Targets are `data-tour` attributes added in BusinessView, ToolCard and SetupPanel; no logic changes there.
- Replay: in each step's card, that step's excerpt from the example's saved `messages` plays first: the owner's
  bubble, typing dots, the agent's reply typed in, then the spotlight lands. A "Play all" mode advances on its own
  (about 6 s a step) for an unattended loop; manual is the default. With reduced motion, text appears at once.

### Previews

- New subagent `sandbox/.claude/agents/screen-demo.md`, a sibling of `site-demo`, for every job except a
  website-chat or booking tool on a shop that has a website (those keep the your-site clip).
- It writes one `index.html` at 1280x720: the shop's own photo filling the frame (their brand colours if there is no
  photo), with a phone in front showing the tool's screen for that job, using this shop's real words:
  - reviews: a customer review about a real item from their site, then the reply signed by the shop
  - social-posts: a post drafted around a real item or special
  - missed-calls: a missed call, then the text back with their real hours
  - booking or website-chat with no website: the booking or the answer on the phone
  - books, quotes, marketing-msgs, menu-inventory: the finished invoice, quote, text blast or stock list, with
    only real items and prices from their site (no amount where they list none)
- Revised after 26 added `preview record` (a frame-by-frame recording with an injected cursor and typing, encoded
  with imageio-ffmpeg, cost 0): the tool's screen is RECORDED, not drawn by Veo, so every word stays readable. The
  phone block marks its steps with 26's contract (`data-step`, `data-act=click|type|show`, `data-opens`,
  `data-panel`, `data-clears`, `data-text`, `data-typing`). `preview frames` + `make --first --last` stay as the
  fallback.
- Veo opener (OpenRouter): a 4 s image-to-video clip that starts from the shop's own photo and brings it to life
  (steam off a cup, someone at the counter, no on-screen text). The final clip is the opener, then the recording,
  joined into one mp4. About $0.20 a clip. It is the first thing dropped if time runs short; the recording alone
  still shows how the tool works in the shop.
- Preview skill: website-chat or booking with a website, 26's your-site recording (26 owns that branch); anything
  else, the screen recording with the Veo opener; the plain one-shot prompt only if everything else fails.
- Examples: render each example's clip once with the same subagent instructions, save it under
  `web/public/demo-media/<slug>/`, and point that example's preview at it. Vigilante's comes from the live agent
  during the rehearsal run. About $1-2 of OpenRouter in all.
- Built by three parallel subagents: the tour, the screen recordings, and the Veo opener plus join.

## Left to the builder

The exact note wording per example, the spotlight and note-card styling (graphite tokens), the phone frame, step
timing, and which run excerpt belongs to which step.

## Checks

- A Playwright test: the tour starts, steps through all seven, opens and closes the sheets, closes on Esc, and fits
  at 390 px wide.
- Screenshots of every step at phone and desktop width in the scratchpad.
- Each example clip checked frame by frame against its two frames; a garbled clip is not shipped.

## Order

Tour first (web only), then the screen-demo subagent and the example renders, then one ship with Ishaan's OK.
