# Browser Use setup helpers: design

Date: 2026-11-17. Status: approved by Ishaan at 13:55, with two additions the same afternoon: section 8 (the "your site" demo clip)
and no account email or password shown to the owner (section 4).
Deadline: the finals demo, tonight at 7 pm, VMH 1505.

## Why

The owner should only ever say "set it up". After that the agent does all the sign-up work by itself:
- making the account;
- the verification email;
- the password;
- configuring the tool from the shop's website.

The owner is never asked anything along the way. They can still see everything the agent does in a browser
for them, through a live, view-only window on their page. The text that confirms the setup includes a link
to that window.

Today a setup runs through TinyFish's AI agent, one tool at a time. It takes minutes, and it stops at every
CAPTCHA. Yesterday another session built recorded sign-ups (`~/.claude/skills/mainstreet-signups`) for four
tools: SchedulingKit, Picktime, RZRV and Chatling.
- They replay in Browser Use cloud browsers with no AI model involved, in 13 to 70 seconds each.
- All four passed together twice.

They live outside the product, so the product doesn't use them. This work moves them into the product.

## What the owner sees

iMessage (one approval covering two tools):

```
MainStreet AI: Want me to set up a booking page (Picktime) and a website chat (Chatling) for you?
               [ Yes, set it up ]  [ Not now ]
Owner:         Yes, set it up
MainStreet AI: Setting up Picktime and Chatling now. Watch it live: https://<site>/b/<owner>#setup
               [link card: the owner's page]
   ... about a minute later ...
MainStreet AI: Done. Your booking page is live at <public link>, and the chat assistant is trained on your
               site.
```

Website Setup tab, while it runs (one live window per tool, side by side on desktop, stacked on a phone):

```
+-------------------------------+  +-------------------------------+
| ● Live: Picktime              |  | ● Live: Chatling              |
| [ view-only browser window ]  |  | [ view-only browser window ]  |
+-------------------------------+  +-------------------------------+
```

## Goals

1. One "set it up" starts one helper per approved tool, and the helpers run at the same time.
2. Each helper uses the tool's recorded sign-up when there is one. If there's no recording, or the recording
   breaks before the account exists, it falls back to Browser Use's AI agent, then to TinyFish's.
3. Browser Use solves CAPTCHAs by itself (Ishaan's decision, 2026-11-17).
4. Each live browser shows on the owner's Setup tab as soon as it starts. The window is view-only.
5. The owner's yes, on iMessage or on the website, is answered at once with a text that includes the watch
   link.
6. The rehearsal on the deployed site passes before 6:30 pm: yes, then the watch text, then live windows,
   then the done text.

## Non-goals (not tonight)

- Recorded sign-ups for any tool beyond the four. Lovable stays out: it refuses our inbox addresses.
- A frame relay that keeps the live link from the viewer's browser altogether. Revisit after the finals.
- Recordings or screenshots sent over iMessage.
- An iMessage app.
- Changing the match or plan logic that decides which tools to offer.

## Anti-goals (a failure even if it works)

- The owner gets asked something along the way, or sees a step they have to do, when Browser Use could have
  done it.
- A card is entered anywhere, or a paid plan or trial starts. Free plans only.
- The agent publishes something live on the owner's real website, emails the owner's customers, or invites
  people.
- A live link, password, phone number or message text shows up in a log.
- The demo depends on a step that wasn't rehearsed on the deployed site.

## Constraints

**Shared files.** The demo-alignment session (`ishaankalra-d8`) is editing these in the same working tree:
- `api/src/msapi/*` (runner.py, imessage.py, app.py);
- `web/components/BusinessView.tsx` (it has uncommitted changes there);
- the relay.

So changes to those files go to d8, or happen only after d8 says go (section 7).

**Approval and permissions.** Each of these needs Ishaan's OK at the time:
- storing the key in Secret Manager;
- the agent deploy;
- the web deploy;
- any live Browser Use run.

Approval doesn't carry over from one to the next.

**Never in logs or chat:** API keys, live links, passwords, phone numbers, message text.

**Sandbox limits.** The sandbox container runs one `claude -p` per turn with 1 GB of memory, 1.5 CPUs and a
256-process limit. Turns for one owner run one at a time. A turn times out after 1500 s.

**Approval gate.** The approval is enforced in code (`check_approval` in tf.py reads the read-only
`/decisions` mount). The new tool keeps that gate.

## Approaches

| | What | Trade-off |
|---|---|---|
| **A+ (picked)** | Helpers replay the recorded sign-ups. When there is no recording, or it breaks, they use Browser Use's AI agent, then TinyFish. | Sign-ups finish in about a minute, the same way every time. The sandbox needs Playwright and the recordings move into the repo. About an hour more work than A. |
| A | Helpers give Browser Use's AI agent a goal for each sign-up. | Works for any tool with a written goal (only Chatling has one). 3 to 7 minutes per sign-up, and it can wander. |
| B | Helpers click through the cloud browser themselves, one Claude turn per action. | Claude judges every screen, but a sign-up takes several times longer and it's about a day of work. |
| Dropped | No helpers: the main agent looks after several runs itself. | Simpler, but Ishaan asked for helpers, and it keeps the main agent tied up checking runs. |

Ishaan picked A+, with CAPTCHA solving on.

## Design

### 1. The `bu` tool (new, sandbox)

`sandbox/tools/src/mstools/bu.py` is a CLI like `tf`, installed with the other mstools. The recorded flows are
copied from the skill into `sandbox/tools/src/mstools/flows/` (chatling, picktime, rzrv, schedulingkit; the
runner's `Ctx`, `guard` and `Mail` are ported in). `playwright` is added to the mstools dependencies. Only the
Python client is needed: it connects over CDP and downloads no browser.

`bu setup --tool T --approval AP --inbox ADDR --password PW` runs these steps:

1. **Check the approval.** Same check as `tf` (shared helper): the approval must be approved and cover `T`.
   Each tool gets at most two cloud-browser runs per approval.
2. **Check the budget.** New cap `browser_owner` = $1.00 per owner. A recorded run reserves $0.02. An AI agent
   run reserves its `maxCostUsd` of $0.40.
3. **Recorded path.** Runs when the catalog tool has a flow (catalog `setup.flow`, e.g. `"rzrv"`).
   - **Start the browser.** `POST /api/v4/browsers` with:
     - `solveCaptchas: true`;
     - `proxyCountryCode`: the flow's `PROXY` (Picktime and Chatling set `"us"`; others off);
     - a 1440x900 screen;
     - a timeout of about 10 minutes.
   - **Show the live view straight away.** Write the browser's `liveUrl`, with `readOnly=true&ui=false` added,
     into the tool's setup record (`streaming_url`) before the first page loads. It goes on the record only
     while the status is `running`.
   - **Run the flow.** Connect with `connect_over_cdp` and run it with the business facts from
     `/work/profile.json`, mapped to what the flows read:
     - `name`, `first`, `website`, `city`, `phone`, `service`;
     - missing fields get safe defaults.

     Verification mail is read through `mstools.inbox` (it already handles plus-addresses of `MS_INBOX_BASE`).
   - **`guard()` with CAPTCHA solving on.** It no longer stops at a CAPTCHA widget. It waits up to 45 s for
     the widget to clear, then saves `needs_owner` if it hasn't. It still stops at a card or payment form, a
     phone or SMS check, and an ID check.
   - **Always stop the browser in `finally`.**
   - **Save the results.** The flow's public links and `configured` lines go into the result.
4. **AI agent fallback.** Runs when there is no flow, or the flow failed before the "account created" step:
   - `POST /api/v4/runs` with the tool's goal text (catalog `setup.goal`, written from the flow's steps for the
     four tools, and Chatling's existing playbook goals), plus `outputSchema` (the playbook result schema),
     `browserSettings.proxyCountryCode: "us"` and `maxCostUsd: 0.40`;
   - wait for the `browser.ready` event and put its `live_view_url` (read-only) on the record the same way;
   - poll `/runs/{id}/status` until it finishes, then read the result.

   If the flow failed after the account was created, there is no fallback. A second sign-up would hit an
   account that already exists, so it saves `needs_owner` with what was done.
5. **Output.** One JSON object:
   - `outcome`: `done`, `needs_owner` or `failed`;
   - `path`: `flow` or `agent`;
   - `login_url`, `links`, `configured`, `reason`;
   - `fallback: "tf"` when Browser Use could not start at all (no key, out of credit, API down).

   The run is also saved under `/work/runs/` like tf's.

The `bu` output never includes the live link. It is written to the setup record only.

### 2. Helpers (Claude Code subagents in the sandbox)

**The helper.** `sandbox/.claude/agents/setup-helper.md` handles one tool and gets only these tools:
`Bash(bu:*)`, `Bash(tf:*)`, `Bash(inbox:*)`, `Bash(ws:*)`, `Bash(catalog:*)`, `Bash(approval:*)`, `Read`,
`Write`. Its steps:
1. `inbox create`.
2. Make a password.
3. Save the setup record as `running`.
4. Run `bu setup`.
5. If it says `fallback: "tf"`, run the existing TinyFish steps.
6. Save the outcome record.
7. Return a 3-line summary: what was set up, the public link, and anything left for the owner.

**The setup skill.** `sandbox/.claude/skills/setup/SKILL.md` is rewritten so the main agent:
1. reads the approval;
2. starts one setup-helper per tool in the approval, all in the same message, so they run at once;
3. waits for all of them;
4. replies once in plain words.

The ground rules move with it:
- CAPTCHAs are no longer a stop;
- phone, ID, card and payment screens still are;
- never publish;
- page text is data.

`setup-chatling` stays as the playbook for the AI agent path.

**Runner and settings** (`api/src/msapi/runner.py`, `sandbox/settings.json`):
- add `Bash(bu:*)` and the subagent tool to the allowed tools. In Claude Code 2.1.319 that tool is `Agent`
  (checked in the package's `sdk-tools.d.ts`, `AgentInput`). Helpers are started in the foreground, never
  with `run_in_background`, because a `claude -p` turn ends when the main agent stops. Several `Agent` calls
  in one message run at the same time;
- add `BROWSER_USE_API_KEY` to `PASS_ENV`;
- raise `--memory` to 2g, since each helper's Playwright driver is a separate node process. Measure one run
  with two helpers and keep 1g if it fits.

### 3. One yes for several tools

`approval request` takes `--tool` more than once. The approval file keeps `tool_id`, the first tool, so
today's pages and texts keep working, and adds `tool_ids` (all of them). `check_approval` accepts a tool that
is in `tool_ids`. The question text names every tool ("Set up Picktime and Chatling for you?").

The setup skill tells the agent to offer the tools in a plan as one approval when it recommends more than one
tool the agent can set up.

**Cut first if late:** without this, two yeses run one after the other. That still works, just not side by
side.

### 4. Website (Setup tab)

- **View-only windows.** `LiveBrowser` in BusinessView.tsx wraps the iframe as Browser Use's docs show:
  - an `inert` wrapper;
  - `tabIndex={-1}`;
  - `pointer-events: none`;
  - `allow="autoplay"`.

  The "Open full screen" link stays; the link already carries `readOnly=true`. Two windows sit side by side
  from the desktop breakpoint up.
- **Opening on the Setup tab.** `/b/<owner>#setup` opens the Setup tab, so the watch link in the text lands on
  the live windows. Until a stream exists, a running setup shows "Starting the browser…".
- **No login details.** Ishaan, 14:00: "i dont see any reason to show the agent email and password to the
  user". The Setup card drops the Username and Password rows and the "Log in at" row. In their place it shows the
  tool's public page when there is one ("Your booking page", "Your chat page"). The API bundle stops sending
  `username` and `inbox` (the password was already withheld). The agent's rules say never to mention the account
  email or password, and a setup the agent couldn't finish is described as what's done and what's left, with an
  offer to try again, never as "log in with ...".
- **Copy.** Copy that says we stop at the human check (the `SetupReplay` steps) is changed. The agent now gets
  past CAPTCHAs, and only phone, ID or card steps come back to the owner.

### 5. iMessage

On a yes, the owner gets this text at once: "Setting up <tool names> now. Watch it live: <page>#setup".
- **iMessage path:** in `imessage.vote()` after the turn starts, the text goes out through `push`. It is the
  turn's interim reply, so it isn't sent twice.
- **Website path:** in `web_decided()`, the existing "Got your yes" text gains the link.

The done text is unchanged: it already comes from the turn's reply through `_turn_finished`.

### 6. Rules text

These change to match the CAPTCHA decision:
- `sandbox/CLAUDE.md` (the "Stop at any CAPTCHA" line);
- the setup skill's ground rules;
- the setup-chatling goals (no "stop at CAPTCHA").

Card, payment, phone, ID and publish rules stay.

### 7. Secrets, deploy, coordination

- **The key.**
  - Secret Manager `browser-use-api-key`, loaded from Keychain `BROWSERUSE_API_KEY`;
  - `fetch-secrets.py` maps `BROWSER_USE_API_KEY` to it as an optional secret, so the agent still starts
    without it and `bu` falls back to `tf`.
  - Needs Ishaan's OK.
- **Deploy.**
  - Agent: `deploy/gcp/push.sh` rebuilds the sandbox image and restarts msapi.
  - Web: `vercel deploy --prod` for the Setup tab. That deploy has to pass the og-video deploy gate. The site
    already has og tags; check with `check_og.py`.
  - Each deploy needs Ishaan's OK.
- **Who edits what.** This session takes the sandbox (`bu`, flows, helper, skills, settings, CLAUDE.md,
  catalog) and the tests. The three d8 files (runner.py, imessage.py, BusinessView.tsx) are listed with the
  exact changes in a ccbridge message to d8. d8 makes them, or says go for this session to.

### 8. "Your site" demo clip (added 13:55)

Ishaan: a helper remakes the shop's homepage with the tool built in, two pictures are taken of it, and the video
model makes the run-through between them. It replaces the plain preview for tools that live on the shop's
website (catalog `need_ids` containing `website-chat` or `booking`); other tools keep today's preview.

- **`preview site-info --url <website>`** opens the real site in a Browser Use cloud browser (1280x720) and
  saves a screenshot to `/work/tmp/demo/real.png` plus JSON: page title, main colours (computed background,
  text and button colours), fonts, the logo and the largest photos (absolute URLs), headline and nav labels.
- **`site-demo` subagent** (`sandbox/.claude/agents/site-demo.md`, tools `Read`, `Write`, `Bash(preview:*)`,
  `Bash(ws:*)`, `Bash(catalog:*)`). It reads `real.png`, the JSON, the profile and the tool, and writes one file,
  `/work/tmp/demo/index.html` (Ishaan, 14:10: one index.html so adding the tool is simple): all CSS inline, no
  other local files, the shop's images by absolute URL. The tool is one self-contained block (its own `<style>`
  and markup) placed last in `<body>` between `<!-- tool -->` and `<!-- /tool -->`, so adding or swapping the tool
  is one paste. The page is a 1280x720 rebuild of the homepage's top screen in the shop's colours,
  fonts, logo and photos, with the tool built in. Adding class `open` to `<html>` shows the tool in use:
  - website chat: the chat window open with a customer's question and an answer taken from the shop's real
    facts (hours, menu, address);
  - booking: the booking panel open on the shop's real service with a time picked.
- **`preview frames --html /work/tmp/demo/index.html`** renders the file in a cloud browser twice, closed and open, to
  `/work/demo_first.png` and `/work/demo_last.png`. The subagent looks at both and fixes the HTML once if
  anything is off.
- **`preview make --tool T --prompt P --first demo_first.png --last demo_last.png`** sends both pictures to
  Veo 3.1 Lite as `frame_images` (`first_frame`, `last_frame`), 8 s, 16:9, 720p, no audio, about $0.40. The
  prompt asks for a static screen-recording look: a cursor moves to the widget, it opens, the answer types
  in. The record gets `kind: "site"` so the page says "AI-made preview of <tool> on your website".
- It's a preview record like today's, so the card's "Watch the AI preview" button and the iMessage video card
  pick it up with no other change. If `site-info` or `frames` fails, the agent makes today's plain preview.
- Budget: the same preview caps (per owner and the $20 global video cap). The two cloud browsers cost under a
  cent.

## Testing

**Unit (sandbox, pytest, no network).** `bu` against a fake Browser Use API and a fake page:
- the browser request has `solveCaptchas: true` and the flow's proxy;
- the record gets a `readOnly=true` stream before the first step, and only while `running`;
- the budget is reserved;
- an approval without the tool is refused;
- a flow failure before the account exists goes to the agent path, and after it goes to `needs_owner`;
- `fallback: "tf"` when the API refuses;
- the browser is stopped on every path;
- the live link never appears in stdout.

Also: `approval request` with two tools, and `check_approval` with `tool_ids`.

**API (pytest).** A yes vote queues the watch text with the `#setup` link at once. The web yes text has the
link.

**Web (Playwright).** The live window is inert and has `pointer-events: none`, two streams show side by side
at 1280 px, and `#setup` opens the Setup tab.

**Live, with Ishaan's OK:**
1. One `bu setup` of RZRV (about 15 s, under a cent) in a local sandbox container, with a throwaway owner
   workspace.
2. After the deploy, a full rehearsal on the live site with an example business: yes, watch text, live
   windows, done text.

The second is the gate for goal 6.

## Risks

- **Vendors change their pages.** The flows were checked this morning (2026-11-17 timings in the skill).
  Fallbacks are the AI agent path, then the backup videos in `~/.local/share/aisb-signups/demo-videos/`.
- **Memory with two Playwright drivers in one 1 GB container.** Measure it, then raise the limit.
- **The CAPTCHA solver.** It may take longer than the flow's step timeout. `guard` waits up to 45 s.
- **Browser Use plan concurrency.** Check `activeSessionCount` in the billing account before the rehearsal.
- **Whether `claude -p` really runs several foreground `Agent` calls at once in 2.1.319, and whether
  subagents get the parent's `--allowedTools`.** Verify both with one local run of the image before building
  on them.

## Settled after the builder check

The builder check raised the points below. Each was either already answered in the conversation with Ishaan
or is a small call I made; the calls are marked as mine.

- **"Account created" marker (my call).** The flows already log a step named "account created…": RZRV,
  SchedulingKit and Chatling do. Any step whose name starts with "account created" sets
  `ctx.account_created = True`; Picktime gets one if it lacks it. A failure with the flag unset goes to the AI
  agent path. A failure with it set goes to `needs_owner`.
- **Catalog.** `sandbox/catalog.json` is edited by hand. For picktime, schedulingkit, rzrv and chatling:
  - `setup.agent_setup` becomes `true`;
  - each gets `setup.flow` (and `setup.goal` for the agent path).

  `agent_setup` is what lets the agent offer "I can set this up". Turning it on for the three tools is the
  intended effect of Ishaan picking the four recorded tools. The match logic itself doesn't change.
- **One approval, several tools (my call).**
  - The pages already show the approval's `summary`, which names every tool.
  - Setup records are already one per tool.
  - `web_decided` and the vote text name the tools from `tool_ids`, falling back to `tool_id`.
  - Places that still read only `tool_id` show the first tool's name, which is fine for tonight.
- **Helpers and the gates.** The approval check and the budget are enforced inside `bu` and `tf`, so they hold
  whatever tool list a helper is given. Two helpers write different files:
  - `setup/<tool>.json` for the setup records;
  - their own run files;
  - the budget ledger, which is already file-locked.

  `inbox create` hands out a new plus-address without writing any state. Whether subagents get the parent's
  allowed tools is checked in the local run (Risks).
- **Who can see the live link.** It's the same as today's TinyFish stream and the setup password: anyone with
  the owner's page link. Ishaan chose to share the view-only link with the owner. `bu` never prints it, and the
  API doesn't log setup records.
- **Passwords.** Changed by Ishaan at 14:00: the account email and password are never shown to the owner, on
  the page or in a text. They stay in the setup record so the agent can log back in. See section 4.
- **How `guard()` knows a CAPTCHA cleared (my call).** It polls every second for up to 45 s. Cleared means:
  - no visible reCAPTCHA or hCaptcha challenge iframe, or its response field is filled;
  - a Turnstile token is present.
- **Run limits (my call).** Each provider gets its own counter per tool per approval:
  - Browser Use: two runs, one recorded and one agent;
  - TinyFish: its existing two (sign-up, then verify and configure).

  `bu` only says `fallback: "tf"` when Browser Use couldn't start a browser at all.
- **Live check.** Ishaan's OK is asked when it's time to run it, not given ahead. The local
  `mainstreet-sandbox` image exists, and the key is in Keychain.

## Left to the builder

- The exact mapping from `profile.json` to the flows' `biz` fields, and safe defaults.
- Goal texts for the AI agent path for the three tools without a playbook.
- Poll intervals and timeouts inside `bu`, kept under the 1500 s turn timeout with two runs in parallel.
- Whether `bu` shares tf's approval and budget helpers by import or by moving them to a small shared module.
