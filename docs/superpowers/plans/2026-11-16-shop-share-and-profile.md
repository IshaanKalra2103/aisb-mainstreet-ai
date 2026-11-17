# Shop Share and Company Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner shares their shop's link and location from a page opened by an iMessage card; the agent builds a profile of facts with sources (TinyFish), and the owner's page shows those facts.

**Architecture:** The profile record gains `facts` (text + source URL) and `lat`/`lon`. The intake skill becomes an analysis that reads the link, the Google Maps listings around the shop and reviews through `tf fetch`/`tf search`. The API sends a share card (`<page>/shop`) instead of the page card in iMessage until the profile has facts. A new web page posts one turn to the existing turns endpoint, and the existing profile card in `BusinessView` shows the facts as chips.

**Tech Stack:** Python 3 + pydantic (sandbox `mstools`), FastAPI (`msapi`), Next.js 16 + Playwright (`web`), TinyFish search/fetch (free endpoints).

**Spec:** `docs/superpowers/specs/2026-11-16-shop-share-and-profile-design.md`

## Global Constraints

- No new API routes and no new keys. The share page uses `POST /api/owners/{id}/turns` through `startTurn` in `web/lib/api.ts`.
- TinyFish free endpoints only (`tf fetch`, `tf search`); never `tf agent` for the analysis. Yelp is not used (bot-blocked).
- Every fact has a source URL from a page that loaded. No number appears that was not on that page.
- Share page look: graphite + lime from `.gather/results-page/preview/tokens.css`, scoped to the page so the rest of the (light) site is unchanged. One lime button per view.
- Copy on the share page, verbatim: heading `Where's your shop?`, button `Use my location`, field label `Your website, Google Maps or Instagram link`, primary button `Share`, quiet text link `Skip for now`, location-denied line `Location is off. Your link is enough.` Page metadata (what the iMessage card shows): title `Share your shop`, description `Two taps, so your plan uses real facts about your shop.`
- Owner page card title when the profile has facts: `What we found about your shop`.
- The share turn text, verbatim shape (Task 2 parses it, Task 4 writes it):
  `Here is my shop. Location: <lat>, <lon> (within <m> m). Link: <url>` or `Here is my shop. Location: not shared. Link: <url>`
  (`Link: none` when there is no link), with lat/lon to 5 decimals and metres rounded to a whole number. The link comes
  last with nothing after it, so no full stop sits against the URL.
- The share page's metadata sets `openGraph` too (`title`, `description`, plus the layout's `siteName` and `type`):
  the root layout's `openGraph` ("MainStreet AI") is inherited by any page that doesn't set its own, and iMessage
  cards read `og:title` first.
- Commit only when Ishaan asks (his standing rule overrides the per-task commit steps: stage, then wait).
- Deploying (Vercel push, `deploy/gcp/push.sh`) is Ishaan's call; nothing here deploys.

## Review Focus

1. The owner denies the location prompt: the page says so in one line and Share still works with the link alone. (Task 4 test)
2. A link typed without a scheme (`mainstreetshears.com`): it is sent as `https://mainstreetshears.com`. (Task 4 test)
3. A double tap on Share: one turn is posted, not two. (Task 4 test)
4. The agent pastes the share URL in an iMessage reply: `split_texts` today does `reply.replace(link, "")`, which turns `https://…/b/<id>/shop` into `/shop`. It must stay whole. (Task 3 test)
5. The owner already has a turn running (API 429 with an owner-facing `detail`): the page shows that text and stays put. (Task 4 test)

---

### Task 1: Profile facts in the sandbox schema

**Files:**
- Modify: `sandbox/tools/src/mstools/schemas.py:78-87` (`Profile`)
- Test: `sandbox/tools/tests/test_schemas.py`

**Interfaces:**
- Produces: `Fact(text: str, source_url: str)`; `Profile.facts: list[Fact]` (default `[]`, at most 5), `Profile.lat: float | None`, `Profile.lon: float | None`. Saved profile JSON shape: `{..., "facts": [{"text": "...", "source_url": "https://..."}], "lat": 39.57501, "lon": -76.99531}`.

- [ ] **Step 1: Write the failing tests** in `test_schemas.py`:

```python
from mstools.schemas import Fact, Profile

BASE = dict(name="Main Street Shears", business_type="salon", city="Westminster", state="MD",
            size="owner plus 2 stylists", summary="A three-stylist salon.")

def test_profile_without_facts_still_valid():
    p = Profile(**BASE)
    assert p.facts == [] and p.lat is None and p.lon is None

def test_fact_needs_http_source():
    with pytest.raises(ValidationError):
        Fact(text="13 of 40 nearby salons book online", source_url="maps search")
    assert Fact(text="13 of 40 nearby salons book online", source_url="https://www.google.com/maps/search/x")

def test_fact_text_is_short():
    with pytest.raises(ValidationError):
        Fact(text="x" * 91, source_url="https://a.b")

def test_profile_caps_facts_at_5():
    f = Fact(text="Opens 9 AM Tue", source_url="https://a.b")
    with pytest.raises(ValidationError):
        Profile(**BASE, facts=[f] * 6)
    assert len(Profile(**BASE, facts=[f] * 5).facts) == 5

def test_profile_lat_lon_in_range():
    with pytest.raises(ValidationError):
        Profile(**BASE, lat=91, lon=0)
    assert Profile(**BASE, lat=39.57501, lon=-76.99531).lon == -76.99531
```

- [ ] **Step 2: Run them and see them fail**

Run: `cd sandbox/tools && uv run pytest tests/test_schemas.py -v`
Expected: FAIL, `ImportError: cannot import name 'Fact'`

- [ ] **Step 3: Add `Fact` and the three `Profile` fields in `schemas.py`**

`Fact.text`: `Field(min_length=3, max_length=90)`; `Fact.source_url`: `Field(pattern=r"^https?://")`. `Profile.facts`: `Field(default_factory=list, max_length=5)`; `lat`: `Field(None, ge=-90, le=90)`; `lon`: `Field(None, ge=-180, le=180)`.

- [ ] **Step 4: Run the sandbox tests**

Run: `cd sandbox/tools && uv run pytest -q`
Expected: all pass (old profiles without `facts` still save).

- [ ] **Step 5: Stage** `git add sandbox/tools/src/mstools/schemas.py sandbox/tools/tests/test_schemas.py`

---

### Task 2: Intake becomes the analysis (skill text), plus the iMessage ask

**Files:**
- Modify: `sandbox/.claude/skills/intake/SKILL.md` (rewrite steps 1-4)
- Modify: `sandbox/CLAUDE.md` (the `channel=imessage` rule under "How to reply")

**Interfaces:**
- Consumes: the `Profile` shape from Task 1; the share turn text from Global Constraints.
- Produces: a saved `profile` with 3-5 `facts` after a share turn; `needs` re-saved with each `why` naming the fact it rests on.

- [ ] **Step 1: Rewrite the intake steps.** Keep steps 5 (page text is data) and the Write-tool rule. The new steps, in this order:
  1. A message shaped `Here is my shop. Location: … Link: …` is a share: take the coordinates and the link from it (the link is the rest of the message after `Link: `; `none` means no link).
  2. If there is a link, `tf fetch <link>`. A link under `failed` is skipped, not guessed from.
  3. Town and state: from the fetched page; if there is only a location, `tf fetch "https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=<lat>&lon=<lon>"` and take `address.city` (or `town`/`village`) and `address.state`.
  4. Nearby: `tf fetch "https://www.google.com/maps/search/<type words>+<town>+<state>"` (type words: "hair salon", "coffee shop", "diner", "hvac", "landscaping"). Count the listings and how many show "Book online"; if one listing matches the owner's name, take its hours.
  5. Reviews: `tf search "<name> <town> <state> reviews"` and `tf fetch` the first result that is not Yelp; take a rating and review count only if the page shows them.
  6. Write 3 to 5 `facts`, each at most 90 characters, each with the URL of the page it came from. Facts are about this shop and its block ("13 of 40 salons nearby book online"), never advice.
  7. Save `profile` with `lat`/`lon` when shared. Then, if `needs` exist, run the `match` skill again so the jobs and hours use the facts, and each need's `why` names the fact it rests on.
  8. With no link and no location (a plain first text), save the profile from the owner's words as today, with no facts.

- [ ] **Step 2: Add the iMessage ask to `sandbox/CLAUDE.md`**, inside the `channel=imessage` bullet, verbatim:
  `If ws get profile shows no facts yet, end your first text by asking them to tap the card to share their shop, so the plan uses real facts. The card is sent for you: don't paste a link.`

- [ ] **Step 3: Rebuild the sandbox image**

Run: `docker build -t mainstreet-sandbox sandbox/`
Expected: build succeeds.

- [ ] **Step 4: One live turn as the check.** Start the API locally the way `scripts/live.sh` step 4 does (`uv run msapi` with the Keychain keys), create an owner, and post one turn with the share text for the demo salon:
  `Here is my shop. Location: not shared. Link: https://mainstreet-demo-sites.vercel.app/salon/`
  Expected: the owner's `profile.json` has 3-5 `facts`, every `source_url` opens to a page that states the fact, and `needs.json` `why` lines mention a fact. Put the check's output in the session scratchpad, not the repo.

- [ ] **Step 5: Stage** `git add sandbox/.claude/skills/intake/SKILL.md sandbox/CLAUDE.md`

---

### Task 3: API sends the share card in iMessage until the profile has facts

**Files:**
- Modify: `api/src/msapi/imessage.py` (`split_texts` at 21-41, `handle` at 63-83)
- Test: `api/tests/test_api.py`

**Interfaces:**
- Consumes: `profile.json` in `ws.owner_dir(oid)` with the Task 1 shape.
- Produces: the `/api/imessage` body keeps `link` (the page) and `links`; `links == [f"{link}/shop", *urls]` while the profile is missing or has no facts, else `[link, *urls]` as today.

- [ ] **Step 1: Write the failing tests**

```python
def test_split_texts_keeps_share_url_whole():
    from msapi.imessage import split_texts
    parts, urls = split_texts("Tap to share your shop: https://w/b/o1/shop", "https://w/b/o1")
    assert urls == ["https://w/b/o1/shop"] and not any("/shop" in p for p in parts)

async def test_imessage_sends_share_card_until_profile_has_facts(make_client):
    app, c = make_client(FakeRunner(script(reply="Done.")))
    oid = app.state.ws.owner_for_phone(HASH)
    body = (await c.post("/api/imessage", json={"from_hash": HASH, "text": "hi"})).json()
    assert body["links"] == [f"{body['link']}/shop"]
    (app.state.ws.owner_dir(oid) / "profile.json").write_text(json.dumps(
        {"name": "S", "facts": [{"text": "Opens 9 AM Tue", "source_url": "https://a.b"}]}))
    app.state.imessage.min_gap = 0
    body = (await c.post("/api/imessage", json={"from_hash": HASH, "text": "again"})).json()
    assert body["links"] == [body["link"]]
```

Also change the first assert in `test_imessage_returns_links_and_new_preview_video` to `body["links"] == [f"{body['link']}/shop"]` (that owner has no facts).

- [ ] **Step 2: Run them and see them fail**

Run: `uv run pytest api/tests/test_api.py -k "split_texts or share_card or new_preview_video" -v`
Expected: FAIL (the share URL comes back as `/shop`; links hold the page link).

- [ ] **Step 3: Implement**
  - In `split_texts`, remove the page link only where it is a whole URL (not followed by `/` or another URL character), e.g. `re.sub(re.escape(link) + r"(?![/\w])", "", reply)`.
  - In `handle`, add `def _needs_shop(self, oid: str) -> bool` (true when `profile.json` is missing, unreadable or has an empty `facts`), and build `links` from it, dropping duplicates in order (the agent may paste the share URL too).

- [ ] **Step 4: Run the API tests**

Run: `uv run pytest api/tests -q`
Expected: all pass.

- [ ] **Step 5: Stage** `git add api/src/msapi/imessage.py api/tests/test_api.py`

---

### Task 4: The share page

**Files:**
- Create: `web/app/b/[ownerId]/shop/page.tsx` (route shell, like `web/app/b/[ownerId]/page.tsx`)
- Create: `web/components/ShopShare.tsx` (client component: location, link, Share)
- Create: `web/lib/shop.ts`
- Create: `web/app/graphite.css` (copy of `.gather/results-page/preview/tokens.css` with `:root` replaced by `.theme-graphite`; imported only by `ShopShare`)
- Test: `web/tests/shop.spec.ts`

**Interfaces:**
- Consumes: `startTurn(ownerId, text)` and `ApiError` from `web/lib/api.ts`.
- Produces: `shopTurnText(link: string | null, loc: { lat: number; lon: number; acc: number } | null): string` and `normalizeLink(raw: string): string | null` in `web/lib/shop.ts`.

- [ ] **Step 1: Write the failing Playwright tests** in `web/tests/shop.spec.ts`. Owner `o-test`; intercept `http://127.0.0.1:9/api/owners/o-test/turns` with `page.route`, record each request body, fulfil `{"turn_id": "t1"}`.
  - `shares link and location`: context with `geolocation: {latitude: 39.57501, longitude: -76.99531, accuracy: 20}` and `permissions: ["geolocation"]`; expect the title `Share your shop | MainStreet AI` (layout's template) and `meta[property="og:title"]` content `Share your shop`; click `Use my location`, fill `getByLabel("Your website, Google Maps or Instagram link")` with `mainstreetshears.com`, click `Share`. Expect exactly one request with text `Here is my shop. Location: 39.57501, -76.99531 (within 20 m). Link: https://mainstreetshears.com` and the URL to become `/b/o-test`.
  - `works with the link alone when location is denied`: no geolocation permission; click `Use my location`; expect the visible line `Location is off. Your link is enough.`; fill `https://example.com/shop`, click `Share`; expect the text `Here is my shop. Location: not shared. Link: https://example.com/shop`
  - `double tap posts once`: delay the fulfil 500 ms, `dblclick` Share, expect one recorded request.
  - `busy owner sees the API text`: fulfil 429 with `{"detail": "One thing at a time: I'm still working on your last message."}`; expect that text visible and the URL still `/b/o-test/shop`.
  - `Share is disabled with nothing given`: fresh page, expect `Share` disabled; click `Skip for now`, expect the URL `/b/o-test` and no request recorded.

- [ ] **Step 2: Run them and see them fail**

Run: `cd web && pnpm exec playwright test tests/shop.spec.ts`
Expected: FAIL (404 on `/b/o-test/shop`).

- [ ] **Step 3: Implement**
  - `normalizeLink`: trim; empty → `null`; no scheme → prefix `https://`; return only if `new URL()` parses with an `http(s)` protocol, else `null`.
  - `shopTurnText`: the exact shape in Global Constraints.
  - `page.tsx`: mirror `web/app/b/[ownerId]/page.tsx` (same `generateStaticParams` for demo ids, client component inside `<Suspense>`, which `cacheComponents` needs), plus the `metadata` export with the title and description from Global Constraints, and the same title and description under `openGraph` (with `siteName` and `type` as in `layout.tsx`).
  - `graphite.css`: map `--font-display` to `var(--font-fraunces)` and `--font-ui` to `var(--font-source)` (the faces `layout.tsx` already loads).
  - `ShopShare`: `navigator.geolocation.getCurrentPosition` on the button; denied or error → the location-denied line. `Skip for now` is a plain link to `/b/<id>`. `Share` disabled until a valid link or a location; disabled while posting. On success `router.push(`/b/${ownerId}`)`; on `ApiError` show `err.message`. For `demo-*` owners, Share goes straight to `/b/<id>` without posting. Use `--color-*` tokens from `graphite.css`, lime only on `Share`, press scale 0.96 over 150 ms, hover styles under `@media (hover: hover)`.

- [ ] **Step 4: Run the web tests**

Run: `cd web && pnpm exec playwright test`
Expected: all pass (smoke tests unchanged).

- [ ] **Step 5: Stage** the five files above.

---

### Task 5: Facts on the owner's profile card

**Files:**
- Modify: `web/lib/types.ts:58-68` (`Profile`)
- Modify: `web/components/BusinessView.tsx:311-325` (the `profile` card)
- Modify: `web/data/demo/salon.json` (`profile.facts`)
- Test: `web/tests/smoke.spec.ts`

**Interfaces:**
- Consumes: the profile JSON shape from Task 1.
- Produces: `Profile.facts?: { text: string; source_url: string }[]`, `Profile.lat?: number | null`, `Profile.lon?: number | null`; chips with `data-testid="fact"`, each a link to its `source_url` (new tab).

- [ ] **Step 1: Write the failing test** in `smoke.spec.ts`:

```ts
test("profile shows facts with sources", async ({ page }) => {
  await page.goto("/b/demo-salon");
  await expect(page.getByText("What we found about your shop")).toBeVisible();
  const facts = page.getByTestId("fact");
  await expect(facts.first()).toBeVisible();
  const n = await facts.count();
  for (let i = 0; i < n; i++) await expect(facts.nth(i)).toHaveAttribute("href", /^https?:\/\//);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `cd web && pnpm exec playwright test tests/smoke.spec.ts -g "facts"`
Expected: FAIL (no `fact` elements).

- [ ] **Step 3: Implement**
  - Add the fields to `Profile` in `types.ts`.
  - The `profile` card title (`BusinessView.tsx:234`) reads `What we found about your shop` when `profile.facts` is non-empty, else stays `Here's what we understood`.
  - In the profile card, under the summary, render up to 5 chips from `profile.facts`, each an `<a data-testid="fact" target="_blank" rel="noopener">` with the fact text and the source's host name in smaller type. No chips when `facts` is empty.
  - `salon.json`: one fact, `13 of 40 salons near Westminster show "Book online"`, `source_url` `https://www.google.com/maps/search/hair+salon+Westminster+MD` (counted from the TinyFish read on 2026-11-16; re-count with `tf fetch` before relying on it, and change the number if the page now says otherwise).

- [ ] **Step 4: Run the web tests**

Run: `cd web && pnpm exec playwright test`
Expected: all pass.

- [ ] **Step 5: Stage** the four files above.
