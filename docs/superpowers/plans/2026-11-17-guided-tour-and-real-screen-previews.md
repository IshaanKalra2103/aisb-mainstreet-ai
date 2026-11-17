# Guided tour and real-screen previews: implementation plan

> **For agentic workers:** three parallel subagents, one per task, as Ishaan asked. Steps use checkbox (`- [ ]`)
> syntax. Nothing is committed, pushed or deployed by a subagent; d8 packs one ship with Ishaan's OK.

**Goal:** Example pages get a guided tour with a replay of each step's run; previews show the tool's real screen
(recorded) after a short Veo opener made from the shop's own photo.

**Architecture:** The tour is a client overlay (`Tour.tsx`) driven by per-example scripts, finding its targets by
`data-tour` attributes. Screen clips reuse 26's `preview record` (HTML page + injected player, frame by frame,
encoded with imageio-ffmpeg). The opener is a new OpenRouter image-to-video call, joined in front of the recording.

**Tech stack:** Next.js 16 + pnpm (web); Python + uv (sandbox tools); OpenRouter `google/veo-3.1-lite`.

**Spec:** `docs/superpowers/specs/2026-11-17-guided-tour-and-real-screen-previews-design.md`

## Global constraints

- Code freeze about 5:30 pm ET 2026-11-17. Finals 7:00 pm.
- No commits, pushes, deploys, live agent turns or sign-ups. Never print a key: read keys inline with
  `security find-generic-password -s NAME -w`.
- Shared working tree. Do not edit files another session has uncommitted, except where a task says so (re-read right
  before each edit, keep the edit small). 26 has uncommitted: `sandbox/tools/src/mstools/preview.py`, `player.py`,
  `sandbox/tools/pyproject.toml`, `uv.lock`, `tests/test_preview_site.py`, `sandbox/.claude/agents/site-demo.md`,
  step 3 of `sandbox/.claude/skills/preview/SKILL.md`, `web/components/PreviewPlayer.tsx`, and the preview caption in
  `web/components/BusinessView.tsx`. Someone else has `video/tools/rec_screens.mjs`.
- No invented prices, hours or claims in any clip or tour note. Clips carry no brand logos except the shop's own.
- Phone width 390 px with a 16 px gutter, projector width 1280 px, `prefers-reduced-motion` respected.
- Visual QA output goes to the scratchpad `/private/tmp/claude-501/-Users-ishaankalra/3bcc9db2-5419-4742-a64b-5986a4e6e605/scratchpad/`.
- OpenRouter: about $0.20 per 4 s opener. Task 3 may spend at most $2.50 in all.

## Review focus

- A tour step whose target is missing (an example with no preview or no compare): skip that step, never hang.
- Esc or X mid-replay: the overlay, any open sheet and all timers go away; the page scrolls and clicks normally.
- Phone width: the note card never covers its own highlighted target; it docks at the bottom.
- A clip whose words garble or whose layout breaks: not shipped; the example keeps its old clip.
- Veo opener with on-screen text or a different place than the photo: re-roll once, else ship the recording alone.

---

### Task 1: Guided tour on the example pages

**Files:**
- Create: `web/components/Tour.tsx`, `web/data/demo/tours.ts`, `web/tests/tour.spec.ts`, `web/app/tour.css`
- Modify: `web/components/BusinessView.tsx` (data-tour attributes, a "Take the tour" button on example pages, the
  `<Tour>` mount), `web/components/ToolCard.tsx` (data-tour on "Why this score"), one `@import` in
  `web/app/globals.css`.

**Interfaces:**
- Produces: `type TourStep = { id: string; target: string; note: string; action?: string; run?: { owner?: string; agent: string } }`
  and `TOURS: Record<string, TourStep[]>` keyed by example slug (`coffee`, `diner`, `hvac`, `landscaping`, `salon`).
- `target` and `action` are values of `data-tour` / `data-tour-action` attributes. `<Tour slug steps onClose />`.
- Example pages are `/b/demo-<slug>`; their bundle is `web/data/demo/<slug>.json` (saved `messages` = the run).

- [ ] Step 1: Write `web/tests/tour.spec.ts`: on `/b/demo-coffee?tour=1` at 390x844 and 1280x800, the tour opens;
  Next walks 7 steps (`step N of 7` text), each step's highlighted element is in the viewport; step 4 shows the
  "Why this score" content; Esc closes the overlay and no `[data-tour-overlay]` remains; "Take the tour" button
  exists on `/b/demo-coffee` and not on a live owner page.
- [ ] Step 2: Run it on a clean copy and see it fail (see Verification).
- [ ] Step 3: Add the `data-tour` targets: `facts`, `jobs`, `top-job`, `compare`, `score`, `preview`, `decide`,
  `setup`; and `data-tour-action` on the buttons that open compare and the preview.
- [ ] Step 4: Write `tours.ts`: 7 steps per example, notes of one or two plain lines each, specific to that shop,
  and the run excerpt for each step taken from its bundle's `messages` (owner text, agent reply).
- [ ] Step 5: Write `Tour.tsx` + `tour.css`: dim with a cutout around the target, scroll it into view, note card
  beside it (wide) or docked at the bottom (phone), Back/Next/X, arrow keys and Esc, `step N of 7`. Each step plays
  its run excerpt first (owner bubble, typing dots, the agent reply typed in), then lands the spotlight. "Play all"
  auto-advances about 6 s a step. Reduced motion: text appears at once, no animated spotlight. Steps with a missing
  target are skipped. Opening a sheet uses the `data-tour-action` element's click; leaving the step closes it.
- [ ] Step 6: Tests pass; screenshots of every step at both widths in the scratchpad `tour/` folder; look at them.

### Task 2: Screen recordings for every non-site job

**Files:**
- Create: `sandbox/.claude/agents/screen-demo.md`; new clips `web/public/demo-media/<slug>/<tool>-screen.mp4`
  for coffee (apaya, social-posts), hvac (quoteiq) and landscaping (quoteiq); then diner (chatling, website-chat)
  and salon (square, booking) with the `site-demo` instructions if time allows.
- Modify: `sandbox/.claude/skills/preview/SKILL.md` (step 4 only: the non-site branch), `web/data/demo/<slug>.json`
  (`media` and the `previews` record of each re-rendered example).

**Interfaces:**
- Consumes: 26's `preview record --tool T --html /work/tmp/demo/index.html` and its step contract in
  `sandbox/tools/src/mstools/player.py` (`data-step`, `data-act=click|type|show`, `data-opens`, `data-panel`,
  `data-clears`, `data-text`, `data-typing`, `window.__mt.seek(t)`).
- Consumes from Task 3 (names fixed here): `preview opener --tool T --photo <url|path> --prompt P` writes
  `/work/opener_<tool>.mp4`; `preview join --tool T` puts the opener in front of `/work/preview_<tool>.mp4`.

- [ ] Step 1: Write `screen-demo.md` (model sonnet, tools Read/Write/Edit/Bash): one `index.html`, 1280x720, the
  shop's own photo full frame (brand colours if none) with a phone in front showing the tool's screen for that job,
  marked with the step contract, using only real words from the profile and site. One template per job: reviews,
  social-posts, missed-calls, booking/website-chat without a site, books, quotes, marketing-msgs, menu-inventory.
- [ ] Step 2: For coffee, hvac and landscaping write the page by hand from `screen-demo.md`, record it locally
  (local Playwright Chromium with `player.PLAYER_JS` and `__mt.seek`, the same frames and encoder as `record`, no
  Browser Use spend), and look at the frames: every word readable and real.
- [ ] Step 3: Save each as `<tool>-screen.mp4` (plus a jpg poster) and point the example's `media` at it.
- [ ] Step 4: SKILL.md step 4: anything that is not website-chat/booking on a shop with a website gets screen-demo,
  `preview record`, then `preview opener` + `preview join`; plain one-shot prompt only if all of that fails.
- [ ] Step 5: If time allows, diner and salon with the site-demo instructions and the same local recording.

### Task 3: Veo opener and join

**Files:**
- Create: `sandbox/tools/src/mstools/opener.py`, `sandbox/tools/tests/test_opener.py`; opener clips
  `scratchpad/clips/<slug>/opener.mp4` for the five examples.
- Modify: `sandbox/tools/src/mstools/preview.py` only by a hook of at most 4 lines in `main()` that calls
  `opener.register(sub)` and `opener.handle(a)`; send the exact hunk to d8 instead of editing (26 is editing it).

**Interfaces:**
- Produces: `opener.make_opener(tool: str, photo: str, prompt: str, seconds: int = 4) -> dict` (OpenRouter
  `/api/v1/videos`, `google/veo-3.1-lite`, the photo as `first_frame` only, 720p 16:9, no audio; same budget checks
  and `charge` as `preview.make`; writes `/work/opener_<tool>.mp4`); `opener.join(tool: str) -> dict` (imageio-ffmpeg:
  scale both to 1280x720, re-encode H.264 faststart, a 0.3 s crossfade, replaces `/work/preview_<tool>.mp4` and
  updates the saved preview record); `register(sub)`, `handle(a) -> dict | None`.

- [ ] Step 1: Tests in `test_opener.py` with a fake HTTP client (as `test_preview.py` does): first_frame only in the
  request, budget charged once, cached opener reused, `join` output exists and its duration ≈ opener + recording.
- [ ] Step 2: Run, see them fail; implement; run, see them pass (`cd sandbox/tools && uv run pytest -q`).
- [ ] Step 3: Check the model accepts a first frame alone (`GET /api/v1/videos/models`), then render one opener for
  coffee from its demo site's hero photo; look at its frames (no text, same place as the photo).
- [ ] Step 4: Render the other four; join each with Task 2's `<tool>-screen.mp4` when it exists into
  `web/public/demo-media/<slug>/<tool>.mp4` (else leave the join to d8).

## Verification (all tasks)

- Web: `D=$(mktemp -d) && git archive HEAD web | tar -x -C $D`, copy changed files in, `cd $D/web && pnpm install
  --frozen-lockfile --prefer-offline && pnpm exec playwright test` (it builds and serves on 3101). For a dev server,
  open `http://localhost:PORT`, never 127.0.0.1.
- Tools: `cd sandbox/tools && uv run pytest -q` (26's tests may be mid-change; report, don't fix theirs).
