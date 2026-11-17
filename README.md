# MainStreet AI

MainStreet AI helps Main Street small businesses (diners, coffee shops, small HVAC firms, landscapers, salons) find AI tools they can trust and get them set up. An owner texts an iMessage line. An agent reads their shop from the web and finds the jobs AI can take off their week. It picks a vetted tool for each job and sets it up once the owner approves.

Built for the UMD AI for Small Business Hack-a-thon, Fall 2026.

<p align="center">
  <img src="docs/assets/share.png" width="260" alt="Share page: Where's your shop? with Use my location, one link field and a Share button">
  <img src="docs/assets/profile.png" width="260" alt="Profile card: What we found about your shop, with a fact and its source">
  <img src="docs/assets/job.png" width="260" alt="Job card: online booking and reminders, our pick Square, verified, 75/100">
</p>

## How it works

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/how-it-works-dark.png">
  <img src="docs/assets/how-it-works-light.png" alt="Flowchart in two lanes. You, the shop owner: 1 text the MainStreet number, 3 share your location and one link, 5 see what we found with each fact's source, 7 watch an AI video of the tool in your shop, then say yes. MainStreet AI: 2 texts back a Share your shop link, 4 reads your website and nearby Google Maps listings, 6 finds jobs AI can do and a trusted tool for each, 8 sets the tool up for you.">
</picture>

Under the hood:

- **iMessage** (`imessage/`) relays texts to the API. Replies come back as up to 3 short texts plus native iMessage UI: the owner's plan as an app card with a photo of their street, iMessage's own "share your location" request in place of the share page, and a yes/no poll when the agent asks to set up a tool. A vote on the poll approves or declines the setup, the same as the buttons on the page.
- **Each turn runs in a sandbox.** The API (`msapi`) runs Claude Code in a Docker container with three tools: `tf fetch` (TinyFish) reads the shop's link and the nearby map listings, `ws` saves records, and `match` checks needs against the vetted catalog.
- **Every fact has a source.** The profile holds 3 to 5 short facts, each linked to its page, for example *13 of 40 Google Maps listings near Westminster show "Book online"*.
- **Nothing is set up without a yes.** Each job gets one vetted pick with a trust score, and setup waits for the owner's approval.

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
