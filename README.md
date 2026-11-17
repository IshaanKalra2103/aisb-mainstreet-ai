<p align="center">
  <a href="https://mainstreet-ai-five.vercel.app"><img src="docs/assets/brand/banner.png" alt="MainStreet AI. AI tools for Main Street, vetted and set up for you. Three phone screens from the app: Where's your shop?, what we found about a salon in Westminster, MD, and a job card for online booking and reminders with Square as our pick, verified by our team, 75/100."></a>
</p>

<p align="center">
  <a href="https://mainstreet-ai-five.vercel.app"><strong>Try the prototype</strong></a>
  &nbsp;&middot;&nbsp;
  <a href="#how-it-works"><strong>How it works</strong></a>
  &nbsp;&middot;&nbsp;
  <a href="#preview-videos"><strong>Preview videos</strong></a>
  &nbsp;&middot;&nbsp;
  <a href="#run-it"><strong>Run it</strong></a>
</p>

<p align="center">
  <a href="https://mainstreet-ai-five.vercel.app"><img src="https://img.shields.io/badge/prototype-live-d7ff3a?style=flat-square&labelColor=1c1d22" alt="Prototype: live"></a>
  <img src="https://img.shields.io/badge/iMessage-Photon_Spectrum-34353c?style=flat-square&logo=imessage&logoColor=white&labelColor=1c1d22" alt="iMessage via Photon Spectrum">
  <img src="https://img.shields.io/badge/agent-Claude_Code-34353c?style=flat-square&logo=claude&logoColor=white&labelColor=1c1d22" alt="Agent: Claude Code">
  <img src="https://img.shields.io/badge/web_reads-TinyFish-34353c?style=flat-square&labelColor=1c1d22" alt="Web reads: TinyFish">
  <img src="https://img.shields.io/badge/web-Next.js-34353c?style=flat-square&logo=nextdotjs&logoColor=white&labelColor=1c1d22" alt="Web: Next.js">
  <img src="https://img.shields.io/badge/api-FastAPI-34353c?style=flat-square&logo=fastapi&logoColor=white&labelColor=1c1d22" alt="API: FastAPI">
  <img src="https://img.shields.io/badge/sandbox-Docker-34353c?style=flat-square&logo=docker&logoColor=white&labelColor=1c1d22" alt="Sandbox: Docker">
</p>

<br>

MainStreet AI helps Main Street small businesses (diners, coffee shops, small HVAC firms, landscapers, salons) find AI tools they can trust and get them set up. An owner texts an iMessage line or uses the website: it is the same assistant, the same shop and the same answers either way. An agent reads their shop from the web and finds the jobs AI can take off their week. It picks a vetted tool for each job and sets it up once the owner approves.

Built by Team Forge for the UMD AI for Small Business Hack-a-thon, Fall 2026.

## How it works

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/how-it-works-dark.png">
  <img src="docs/assets/how-it-works-light.png" alt="Flowchart in two lanes. You, the shop owner: 1 text the MainStreet number, 3 share your location and one link, 5 see what we found with each fact's source, 7 watch an AI video of the tool in your shop, then say yes. MainStreet AI: 2 texts back a Share your shop link, 4 reads your website and nearby Google Maps listings, 6 finds jobs AI can do and a trusted tool for each, 8 sets the tool up for you.">
</picture>

Under the hood:

- **iMessage** (`imessage/`) relays texts to the API. Replies come back as up to 3 short texts plus native iMessage UI: the owner's plan as an app card with a photo of their street, iMessage's own "share your location" request in place of the share page, and a yes/no poll when the agent asks to set up a tool. A vote on the poll approves or declines the setup, the same as the buttons on the page.
- **Two doors, one shop.** A shop started on the website shows a short shop code under "Rather text?". Texting it to the line (+1 415 225 0168) ties that phone to the same shop, and from then on a yes, a step that needs the owner, or a finished setup on the website is texted to the phone too. A shop started by text has its page one tap away on the plan card.
- **Each turn runs in a sandbox.** The API (`msapi`) runs Claude Code in a Docker container with three tools: `tf fetch` (TinyFish) reads the shop's link and the nearby map listings, `ws` saves records, and `match` checks needs against the vetted catalog.
- **Every fact has a source.** The profile holds 3 to 5 short facts, each linked to its page, for example *13 of 40 Google Maps listings near Westminster show "Book online"*.
- **Nothing is set up without a yes.** Each job gets one vetted pick with a trust score, and setup waits for the owner's approval. "Not now" answers at once and can still become a yes later, on either door.

The chart's source is [`docs/assets/how-it-works.excalidraw`](docs/assets/how-it-works.excalidraw); open it at excalidraw.com to edit.

## Preview videos

Before saying yes, the owner can see the tool at work in a shop like theirs. The agent writes one scene from the shop's profile, and the `preview` tool renders it as a 6-second clip with Google Veo 3.1 Lite through OpenRouter's video API (720p, no audio, about $0.05 a second). The clip plays on the job card, labelled "AI-generated preview", and arrives inline in iMessage.

<p align="center">
  <img src="docs/assets/preview-salon.gif" width="480" alt="AI-generated preview for a salon: a client books a haircut on her phone at night; next morning the stylist sees the day's schedule on a tablet at the front desk">
</p>

The salon's prompt: *a client books a haircut on her phone at night; next morning the owner sees the day's schedule on a tablet at the front desk, warm natural light, documentary style, no logos.* Clips are cached per tool and capped at 2 per owner, 10 a day and $20 in total.

## Layout

| Path | What it is |
|---|---|
| `web/` | Next.js app on Vercel: share page, owner page, compare, preview, setup; static catalog and demo businesses |
| `api/` | FastAPI (`msapi`): owner workspaces, sandboxed agent turns, approvals, iMessage endpoint |
| `sandbox/` | Docker image the agent runs in: Claude Code with a fixed `settings.json`, `CLAUDE.md`, skills, and the tool CLIs in `sandbox/tools` (`mstools`) |
| `catalog/` | Offline pipeline (`mscatalog`): discover, read, extract, vet, human review, export `catalog.json` |
| `demo-sites/` | Five fictional Maryland business websites |
| `imessage/` | Photon relay from iMessage to the API |
| `scripts/` | `live.sh` (tunnel, deploy, relay) and `prerun_demos.py` |
| `docs/assets/brand/` | Logo: app icon, wordmarks for light and dark backgrounds, and the banner above (1280 x 640, also the repo's social preview). `node docs/assets/brand/src/render.mjs` rebuilds them from `src/brand.html` |

It grew out of Loopcast, a TinyFish GTM app ([tiny-fish-gtm-automation](https://github.com/IshaanKalra2103/tiny-fish-gtm-automation)).

## Run it

```bash
uv sync
uv run pytest                          # Python tests
cd web && pnpm exec playwright test    # web tests
./scripts/live.sh                      # API + Cloudflare tunnel + Vercel env + iMessage relay
./scripts/live.sh stop
```

Keys come from the macOS Keychain: `TINYFISH_API_KEY`, `OPENROUTER_API_KEY`, `AGENTMAIL_API_KEY`, `AISB_CLAUDE_OAUTH`.

<br>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/brand/wordmark-dark.png">
    <img src="docs/assets/brand/wordmark-light.png" height="36" alt="MainStreet AI">
  </picture>
  <br>
  <sub>Team Forge &middot; UMD AI for Small Business Hack-a-thon, Fall 2026</sub>
</p>
