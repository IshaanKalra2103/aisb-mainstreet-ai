# Browser Use setup helpers + "your site" demo clip: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner's yes starts parallel setup helpers that replay recorded sign-ups in Browser Use cloud browsers (view-only live windows on the page, watch link in the text), and website tools get a preview clip made from a rebuild of the shop's own homepage.

**Architecture:** New sandbox CLI `bu` (Browser Use API + recorded Playwright flows over CDP) and a shared `browseruse` client; `preview` gains `site-info`, `frames` and first/last-frame Veo. Two Claude Code subagents in the sandbox (`setup-helper`, `site-demo`) are started by the main agent with the `Agent` tool. The web Setup tab becomes view-only and drops login details.

**Tech Stack:** Python 3.12 (uv, httpx, playwright client only, pytest), Claude Code 2.1.319 subagents, Next.js + Playwright tests, FastAPI (msapi).

**Spec:** `docs/superpowers/specs/2026-11-17-browser-use-setup-helpers-design.md`

## Global Constraints

- Browser Use API: `https://api.browser-use.com/api/v4`, header `X-Browser-Use-API-Key`, env `BROWSER_USE_API_KEY`.
- Browsers start with `solveCaptchas: true`, `browserScreenWidth: 1440`, `browserScreenHeight: 900` (1280x720 for preview renders); always stopped with `PATCH /browsers/{id}` `{"action":"stop"}` in `finally`.
- Live link on records = `liveUrl` + `readOnly=true&ui=false`; never printed to stdout, logs or chat.
- Budget: new cap `browser_owner` = $1.00; flow run reserves $0.02, agent run reserves its `maxCostUsd` $0.40.
- Runs per approval: per tool and per provider, 2 (`bu` and `tf` counted separately).
- Still stop at card/payment, phone/SMS and ID checks; CAPTCHA widgets wait up to 45 s for the solver.
- Never show the account email or password to the owner (page, texts, replies).
- Preview clip: Veo 3.1 Lite, `frame_images` first_frame/last_frame, 8 s, 16:9, 720p, `generate_audio: false`.
- Sandbox tools stay inside `Bash(ws|catalog|tf|inbox|preview|approval|bu:*)`; no curl/wget.
- No commits by this session: d8 packs one commit and one deploy after all suites pass. Deploys and Secret Manager writes need Ishaan's OK.

## Review Focus

- Profile without address/phone/service (most real owners): flows must get safe defaults, not KeyError. Test in Task 3.
- Browser Use key missing or 402 (out of credit): `bu` must answer `fallback: "tf"` and stop nothing it didn't start. Test in Task 2/3.
- Two helpers at once writing records and the budget ledger: per-tool files, locked ledger. Test in Task 3 (two tools, one approval).
- Shop website that blocks or times out in `site-info`: `preview` must fail fast with a message so the agent makes the plain preview. Test in Task 4.
- Old approvals with only `tool_id` (no `tool_ids`): still accepted. Test in Task 1.

---

### Task 1: One approval for several tools; per-tool, per-provider run counting

**Files:** Modify `sandbox/tools/src/mstools/{schemas.py,approval.py,tf.py}`; Test `sandbox/tools/tests/test_approval_multi.py`

**Interfaces:** Produces `tf.check_approval(aid: str, tool: str, provider: str = "tf") -> None` (raises ToolError) and `Approval.tool_ids: list[ToolId] = []`. Run files gain `"provider"` (absent = "tf") and `"tool_id"`.

- [ ] Tests: `approval request --tool a --tool b --summary s` saves `tool_id == "a"`, `tool_ids == ["a","b"]`; `check_approval` passes for `b` when approved with `tool_ids`; passes for an old approval with only `tool_id`; refuses `c`; the third `bu` run for tool `a` is refused while `tf` runs for `a` and `bu` runs for `b` are not counted against it.
- [ ] Run `cd sandbox/tools && uv run pytest tests/test_approval_multi.py -q` → FAIL.
- [ ] Implement (`--tool` with `action="append"`; membership = `tool in (ap.get("tool_ids") or [ap.get("tool_id")])`).
- [ ] Run the file and `uv run pytest -q` → all pass.

### Task 2: `browseruse` client

**Files:** Create `sandbox/tools/src/mstools/browseruse.py`; Test `sandbox/tools/tests/test_browseruse.py`

**Interfaces:** Produces
- `class Unavailable(ToolError)` (no key, 401/402/403, 5xx, connection error)
- `start_browser(proxy: str | None, width=1440, height=900, minutes=10) -> dict` (`id`, `cdpUrl`, `liveUrl`)
- `stop_browser(browser_id: str) -> None` (never raises)
- `view_only(url: str) -> str`
- `run_agent(task: str, schema: dict, on_live: Callable[[str], None], max_cost=0.40, timeout_s=600) -> dict` (`status`, `output`, `cost`)
- `browser(proxy, width, height, minutes)` async context manager yielding `(page, session)` via `playwright.async_api.connect_over_cdp`, stopping the browser on exit.

- [ ] Tests with `httpx.MockTransport`: start body has `solveCaptchas: True` and the proxy; no key → `Unavailable`; 402 → `Unavailable`; `view_only("https://x/v?a=1")` ends `&readOnly=true&ui=false`; `run_agent` calls `on_live` once with the read-only `live_view_url` from the `browser.ready` event and returns the output when status `completed`.
- [ ] FAIL, implement, PASS. Add `playwright>=1.48` to `sandbox/tools/pyproject.toml`.

### Task 3: Recorded flows and `bu setup`

**Files:** Create `sandbox/tools/src/mstools/bu.py`, `sandbox/tools/src/mstools/flows/{__init__,chatling,picktime,rzrv,schedulingkit}.py` (copied from `~/.claude/skills/mainstreet-signups/flows/`, imports unchanged: `ctx.page/biz/email/password/mail/links/configured/step`); Modify `pyproject.toml` (script `bu = "mstools.bu:main"`), `config.py` (`CAPS["browser_owner"] = 1.00`), `schemas.py` (`SetupRecord.links: dict[str, str] = {}`); Test `sandbox/tools/tests/test_bu.py`

**Interfaces:** Consumes Task 1 `check_approval(aid, tool, "bu")`, Task 2 client. Produces CLI `bu setup --tool T --approval AP --inbox ADDR --password PW` → JSON `{outcome: done|needs_owner|failed, path: flow|agent, login_url, links, configured, reason, fallback?: "tf"}`; `biz_from_profile(profile: dict) -> dict` (keys `name, first, city, phone, kind, site, address, service{name,minutes,price}`); `async guard(page) -> None`; `class Stop(Exception)`; `Ctx.account_created: bool` (set by any step name starting "account created").

- [ ] Tests (fake browser context manager + fake flow module): stream written to the setup record as read-only before the flow's first step and only while `running`; stdout never contains the live URL; flow `Stop("card")` → `needs_owner`; exception before "account created" → agent path runs; after → `needs_owner`, no agent run; `Unavailable` on start → `fallback: "tf"`; budget charged `0.02`; `biz_from_profile({"business_name": "X"})` has every key; guard waits for a visible reCAPTCHA iframe to go away (fake page) and raises `Stop("captcha")` after the wait.
- [ ] FAIL, implement, PASS; full `uv run pytest -q` green.
- [ ] Live check (Ishaan's go at 13:55 covers build tests): `bu setup` of rzrv in the local `mainstreet-sandbox` image with a throwaway workspace; expect `done` in < 60 s with a `booking_page` link.

### Task 4: `preview site-info`, `preview frames`, first/last-frame clip

**Files:** Modify `sandbox/tools/src/mstools/{preview.py,schemas.py}` (`Preview.kind: Literal["plain","site"] = "plain"`); Test `sandbox/tools/tests/test_preview_site.py`

**Interfaces:** Consumes Task 2 `browser(...)`. Produces CLI
- `preview site-info --url U` → `{title, colors: {background, text, accent}, fonts, logo, photos: [..≤6], headline, nav: [..]}` and `/work/tmp/demo/real.png`
- `preview frames --html /work/tmp/demo/index.html` (one self-contained index.html; the tool is the block between `<!-- tool -->` and `<!-- /tool -->` at the end of body) → `/work/demo_first.png`, `/work/demo_last.png` (second shot after `document.documentElement.classList.add('open')` + 800 ms)
- `preview make --tool T --prompt P [--first F --last L]` → with frames: body has `frame_images` (data URLs, `frame_type` first_frame/last_frame), duration 8, record `kind: "site"`.

- [ ] Tests: make with frames sends both frame entries and `kind == "site"`; without frames the body is unchanged from today; frames with a missing html file → ToolError; site-info with `Unavailable` → ToolError "Could not open the website".
- [ ] FAIL, implement, PASS.
- [ ] Live check: one clip for the Vigilante Coffee example (≈$0.40) — confirms OpenRouter accepts data URLs; if it refuses, serve frames from `/media/<owner>/demo_*.png` instead (api `workspaces.py` media regex) and pass that URL.

### Task 5: Sandbox agent wiring

**Files:** Create `sandbox/.claude/agents/setup-helper.md`, `sandbox/.claude/agents/site-demo.md`; Modify `sandbox/.claude/skills/{setup,setup-chatling,preview}/SKILL.md`, `sandbox/CLAUDE.md` (CAPTCHA line; password line → no email/password; preview step 3 mentions the site clip), `sandbox/settings.json` (+`Bash(bu:*)`), `sandbox/catalog.json` (picktime/schedulingkit/rzrv/chatling: `agent_setup: true`, `flow: "<id>"`, `goal` for the three without a playbook), `api/src/msapi/runner.py` (`Bash(bu:*)`, `Agent` in ALLOWED_TOOLS; `BROWSER_USE_API_KEY` in PASS_ENV; `--memory 2g`), `deploy/gcp/vm/fetch-secrets.py` (optional `BROWSER_USE_API_KEY` ← `browser-use-api-key`); Test `api/tests/test_api.py` (runner args include `Agent` and pass the key by name).

- [ ] Test first for runner args, FAIL, implement, PASS (`cd api && uv run pytest -q`).
- [ ] Local image run: build `mainstreet-sandbox`, one `claude -p` turn with an approved two-tool approval; confirm two `Agent` calls run at once, subagents can run `bu`, and peak memory. Expected: both setup records `done`.

### Task 6: Website Setup tab (subagent)

**Files:** Modify `web/components/BusinessView.tsx` (LiveBrowser view-only, `#setup` opens Setup tab, "Starting the browser…", two windows side by side ≥1024 px; keep cd's ReadingSite and d8's TextUs/declined state), `web/components/SetupPanel.tsx` (drop Username/Password/"Log in at"; show `links` as "Your booking page"/"Your chat page"; SetupReplay copy), preview caption for `kind === "site"`, `web/lib/types.ts`, `api/src/msapi/workspaces.py` (bundle drops `username`, `inbox`); Tests `web/tests/setup-live.spec.ts`, `api/tests/test_api.py`.

- [ ] Tests: iframe wrapper has `inert` and computed `pointer-events: none`; two streams side by side at 1280 px; `/b/<id>#setup` shows the Setup tab; no "Username"/"Password" text on a done setup; bundle has no `username`/`inbox`.
- [ ] FAIL, implement, PASS; `npx tsc --noEmit`, eslint, full playwright green.

### Task 7: Watch link text (aa owns imessage.py)

**Files:** `api/src/msapi/imessage.py` (`vote()` yes → push "Setting up <names> now. Watch it live: <page>#setup"; `web_decided()` text gains the link; names from `tool_ids`); Test `api/tests/test_push.py`. Sent to aa as an exact request; this session verifies.

### Task 8: Secret, deploy, rehearsal (each step needs Ishaan's OK)

- [ ] Secret Manager `browser-use-api-key` from Keychain `BROWSERUSE_API_KEY` (never printed).
- [ ] Hand d8 the file list + test results; d8 runs all suites, commits, `deploy/gcp/push.sh`, clean-tree web deploy.
- [ ] Rehearsal on the live site before 18:30: yes → watch text → live windows → done text; site clip on the card and as a video card in iMessage.
