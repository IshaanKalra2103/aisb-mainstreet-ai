# Shop share and company profile (short design)

2026-11-16. Approved by Ishaan in chat the same day. Finals demo: Tue 2026-11-17, 7 pm.

## Intent

The owner shares where their shop is and its link. An analysis agent then builds a company profile from real pages,
and the job picks and hours stand on that profile. The owner sees what was found, so "how do you know?" has an answer
on screen (and in Q&A).

## Goals

- In iMessage, the agent asks for the shop through a rich link card, not a long text exchange.
- A small web page takes the location (browser prompt) and one link (website, Google Maps or Instagram).
- The intake step becomes an analysis: read the link, look at the shops around it on Google Maps, look for reviews,
  and save each fact with the page it came from.
- The results page shows a "What we found about your shop" card above the jobs.

## Non-goals

- Reading iMessage location pins or Find My shares (Photon has no location content type; pins would be untested).
- Yelp (TinyFish fetch is bot-blocked there).
- Sending the agent's reply back into iMessage after a web share (the relay only answers incoming texts).
- New API routes or keys.

## Anti-goals

- A fact on the card with no source behind it. Numbers come from fetched pages or are left out.
- A demo that depends on the phone's location: on stage the phone is in College Park, not at the shop. The demo runs
  off the link; the location button is a convenience.

## Approaches

1. **Rich link card to a share page (picked).** The agent's reply includes the page URL; the relay already turns URLs
   into rich link cards. The page posts one turn to the existing `POST /api/owners/{id}/turns`. Location comes from
   the browser, which works on any phone.
2. Read iMessage location pins (`.loc.vcf` attachments) in the relay. Dropped: the SDK has no location type, the
   relay skips non-text today, and nobody has seen one come through Photon.
3. Ask for the town and link in plain texts. Dropped: no location, more back-and-forth, and it is what we have now.

## Decided

- Page at `/b/<ownerId>/shop`, graphite + lime tokens from `.gather/results-page/preview/tokens.css`: "Where's your
  shop?", a "Use my location" button, one link field, one lime Share button.
- The page's turn text carries the link and `lat, lon` (plus accuracy). After Share, the page goes to the owner's
  results page, which shows the turn running.
- Scraping is TinyFish through the sandbox's existing `tf fetch` / `tf search` (free endpoints only, never `tf agent`
  for this).
- Google Maps search pages read fine through TinyFish fetch (tested 2026-11-16: about 40 salons near Westminster MD
  with address, hours and a "Book online" tag on 13). Star ratings did not show in the list view.
- Profile keeps its current fields and gains `facts`: a short list of `{text, source_url}`; plus `lat`/`lon` when
  shared. The card shows the facts as chips with their source.
- Option A from the chat: the profile is shown to the owner, not only used behind the scenes.

## Left to the builder

- Reverse-geocoding the location to a town (the agent can fetch a free reverse-geocode URL, or work from the link).
- How the agent finds the owner's own listing among nearby results (name match against the link's page).
- Exact chip wording and how many facts the card shows (3 to 5).
- Whether a single Google Maps place page gives a star rating and review count (one TinyFish test).
- How each job's hours point back to a fact.
