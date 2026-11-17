# imessage: MainStreet AI iMessage relay

Owners can text the MainStreet AI agent at the Photon line (+1 415 225 0168). This folder is the relay between that line and the agent API, built on [Photon Spectrum](https://photon.codes/docs/spectrum-ts) (`spectrum-ts`). It carries no model logic.

## What it does

For each incoming text message:

1. `from_hash = sha256(message.sender.id)`. The sender id is the Apple address (phone number or email).
2. `POST ${AGENT_API_URL}/api/imessage` with `{from_hash, text}` and the `X-Relay-Secret: $MS_RELAY_SECRET` header. The call waits up to 300 s, because the API gives a turn up to about 280 s.
3. On 200 `{replies, link}`, it sends each reply (at most 3) 3 s apart, then the link to the owner's page (`/b/o_...`). Once the agent has a profile and jobs, the page goes out as an iMessage app card instead of a link card: a photo from the shop's own website (the web's `/api/site-art`, as on the page) with the shop's name and place over it, "Your AI plan" with the number of jobs, and the hours back a week on the right. Without a photo the card keeps the name and numbers. Before there is a plan, or if the page can't be read, the link card goes out as before.
   The API adds the page link only when the turn changed the plan (it wrote the profile, jobs, a comparison, a preview or a setup) or the agent pointed at the page. Otherwise a question like "What's your website link?" would go out under an old plan card. Texting "start over" (also "start fresh", "new shop", "reset", alone in a text) unties the phone from its shop, with no agent turn. Its next text starts a new shop. The old shop stays as it was.
4. On 429 it sends the `detail` text, for example "Give me a few seconds between texts."
5. On any other error (401, 5xx, timeout, API down, bad response), it sends "Sorry, something broke on our side. Try again in a minute."
6. When the API asks for the share page (`/b/o_.../shop`), the relay sends iMessage's own "share your location" request instead (Photon's Find My kit, `src/location.ts`). It checks every 10 s, for up to 15 minutes, whether the owner has shared. Once they have, it posts the share page's turn text (`Here is my shop. Location: <lat>, <lon> (within <m> m). Link: none`) for that owner and texts back the agent's replies. If the request can't be sent (for example, the owner texts from an email address the Photon line may not reach), the share page card goes out as before. At most one request per owner goes out in 15 minutes.
7. When the agent has asked to set up a tool (a pending approval), the API adds `poll: {question, options}` to its reply, once per approval: "Set up Chatling for you?" with "Yes, set it up" and "Not now". The relay sends it last, as a native iMessage poll. A vote comes back as a `poll_option` message; the relay posts `{from_hash, poll, option}` to `/api/imessage/vote`, and the API decides that approval the way the page's buttons do and runs the turn, so the replies come back as texts. A vote can only reach an approval of the voter's own owner; a vote on a question that is already answered gets "That question is already answered. Your page has the latest." Taking a vote back does nothing.
8. Texting first. Something can happen for a texting owner without them texting: a yes on the website, or a setup that finishes. The API puts these texts in an outbox, and the relay sends them into that phone's thread the same way it sends a reply (texts 3 s apart, link cards, video, poll last). What goes in the outbox:
   - On a website yes: "Got your yes on the website. Setting up <tool> now. I'll text you when it's done, or if I need you for a step." It goes in at once.
   - When any website turn of that owner ends (the setup turn included): its result, which can be "done" or "need you for one step".
   - When an iMessage turn outlives the relay's wait (the reply then says "Still working on that. I'll text you when it's done."): its result.
   - When someone adds their number with the website's "Text me" form (`POST /api/phone`): a welcome. The API puts the number on the Photon line's allowed list (the free plan texts only those, 10 at most; the form adds 9 at most), ties it to the shop when the form was on a shop page, and the welcome entry carries the number once (`to`). The relay opens a thread with that number (`im.space.create(im.user(to))`), but only if the number hashes to the entry's `from_hash`, and the API drops the number once the relay has read it. A number that already texts with a shop is not moved to another one by the form.

   The relay polls `GET /api/imessage/outbox?after=<cursor>&epoch=<api start id>` (with `X-Relay-Secret`) every 3 s. It only polls for 30 min after a phone last texted or voted. It keeps polling past that while the API says a texting owner has a turn running (`busy`). On GCP every poll through the waker can start the agent VM, so it must not poll all day. The first poll after a start or a quiet spell only reads the cursor, so old entries are never replayed. The relay remembers each phone's thread from its texts, in memory: after a relay restart, a phone gets pushes again once it texts. Turns started by a text are not pushed, because their reply already goes out.

It ignores its own outgoing messages, non-text messages (attachments, reactions and so on) and empty texts. Texts longer than 2000 characters are cut to 2000, the API's limit. A typing indicator shows while the agent works, where Photon supports it.

The logs carry only the first 12 characters of the sender hash, the outcome and the timing. They never contain a phone number, an email or message text.

## Files

- `src/relay.ts`: the handler, `handleMessage(message, {apiUrl, secret, fetch, send, sleep, typing, log})`. It has no Photon dependency, so it can be tested on its own.
- `src/index.ts`: connects to Photon and calls `handleMessage` for each message, each in its own task so that a slow turn never blocks other senders.
- `src/location.ts`: the native location request and the check for a shared spot. It builds the same low-level Photon client that Spectrum builds from `PROJECT_ID` and `PROJECT_SECRET`, because Spectrum does not expose locations.
- `demo_rich.mjs`: sends the example business Bean & Brick Coffee to one phone as iMessage UI: a plan card and a job card with photos, a yes/no poll and a "done" text with confetti (`node --env-file=.env demo_rich.mjs --to <phone>`). It only sends; a vote on its poll is not acted on.
- `locate.mjs`: the same request and read from the command line, for demos (`node --env-file=.env locate.mjs request|get <phone>`). It prints one JSON line and never the address.
- `test/relay.test.ts`: unit tests with a fake `fetch`, `send` and `sleep`.
- `test/push.test.ts`: unit tests for the outbox poller (`Outbox` in `src/relay.ts`) with a fake clock.
- `test/api.test.ts`: tests against a real local API running the fake agent. They are skipped unless `RELAY_TEST_API_URL` is set.
- `send_rich.mjs`, `send_image.mjs`, `connect_paperclip.py`: left over from the earlier GTM project, and not used by the relay.

## Run

```sh
npm install
AGENT_API_URL=http://127.0.0.1:8787 MS_RELAY_SECRET=<same as the API> npm start
```

`scripts/live.sh` starts the relay for you, with a fresh secret shared with the API. Only one consumer may read the Photon line. Make sure the old `gtm-paperclip` container is stopped (`docker ps --format '{{.Names}}' | grep -x gtm-paperclip` should print nothing), or both will reply.

## Test

```sh
npm test        # unit tests; the API tests are skipped
npm run typecheck
```

To run the API tests too, start the API with the fake agent from the repo root, then run the tests:

```sh
MS_RUNNER=fake MS_API_PORT=8788 MS_WORKSPACES=/tmp/ms/ws MS_BUDGET_DIR=/tmp/ms/budget MS_RELAY_SECRET=test uv run msapi
cd imessage && RELAY_TEST_API_URL=http://127.0.0.1:8788 RELAY_TEST_SECRET=test npm test
```

## Environment

- `PROJECT_ID`, `PROJECT_SECRET`: the Photon project credentials, kept in `.env`. That file is gitignored; don't print it. Get the values from the [Photon dashboard](https://app.photon.codes).
- `AGENT_API_URL`: the agent API. The default is `http://127.0.0.1:8787`.
- `MS_RELAY_SECRET`: must match the API's `MS_RELAY_SECRET`. If it doesn't, the API answers 401 and owners get the sorry text.
- `RELAY_NATIVE_LOCATION=0`: turns the native location request off, so the relay sends the share page card again.
- `RELAY_PUSH=0`: turns texting first off (no outbox polling).
- `AGENT_DIRECT_URL`: an address of the API that cannot start the agent VM (on GCP its internal address, `http://<ip>:8787`, from the `agent-direct-url` metadata). When set, the outbox is polled there all the time, with a 5 s timeout, so a number added on the website is texted even when nobody has texted lately. Texts still go to `AGENT_API_URL`.
- `RELAY_PUSH_WINDOW_MS` (default 1800000, 30 min) and `RELAY_PUSH_INTERVAL_MS` (default 3000): how long after a phone's last text the relay keeps polling the outbox, and how often.
