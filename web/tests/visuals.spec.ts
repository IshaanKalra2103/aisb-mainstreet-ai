import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";

// Photos of the shop on its page and cards, and link cards with a big image for iMessage.
const API = "http://127.0.0.1:9";
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST" };

const SLUGS = ["diner", "coffee", "hvac", "landscaping", "salon"];

test("each example business shows a photo of that kind of shop, never a street view", async ({ page }) => {
  // The example sites have no photos of their own, so each has a credited stock photo; the street photos are gone.
  const credits = JSON.parse(readFileSync("public/shops/credits.json", "utf8"));
  for (const slug of SLUGS) {
    expect(credits[`${slug}.jpg`]?.url, slug).toMatch(/^https:\/\/www\.pexels\.com\/photo\//);
    expect(existsSync(`public/places/${slug}`), `street photos of ${slug}`).toBe(false);
  }
  expect((await page.request.get("/api/street?slug=coffee")).status()).toBe(404);
  await page.goto("/demo");
  for (const slug of SLUGS) {
    const img = page.locator(`a[href="/b/demo-${slug}"] img`);
    await expect(img).toHaveAttribute("src", `/shops/${slug}.jpg`);
    await expect(img).not.toHaveAttribute("alt", /street/i);
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(1000);
  }
});

test("the home page shows the example shops", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('a[href="/b/demo-coffee"] img').first()).toHaveAttribute("src", "/shops/coffee.jpg");
});

test("an example owner page shows the shop above the deck and a photo of the job on each job card", async ({ page }) => {
  await page.goto("/b/demo-coffee");
  const card = (name: RegExp) => page.getByRole("article", { name }).getByTestId("place-photo");
  await expect(page.getByRole("region", { name: "Your business" }).getByTestId("place-photo")).toHaveAttribute("src", "/shops/coffee.jpg");
  // Job 1 of coffee (the website chat) has no preview video, so it shows a photo of the job being done.
  const img = card(/Website chat and FAQ/);
  await expect(img).toHaveAttribute("src", /^\/jobs\/(coffee\/)?website-chat(-2)?\.jpg$/);
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
});

function liveOwner(page: import("@playwright/test").Page, website: string | null) {
  const profile = { name: "Bean & Brick Coffee", business_type: "coffee_shop", city: "Frederick", state: "MD", size: "s",
    website, uses: [], pains: [], summary: "A coffee shop.", facts: [], lat: 39.4143, lon: -77.4105 };
  const needs = { items: [
    { need_id: "website-chat", title: "Answer questions on your website", why: "w", est_hours_saved_week: 2 },
    { need_id: "shelf-stock", title: "Keep the shelves stocked", why: "w", est_hours_saved_week: 1 }] };
  return page.route(`${API}/**`, async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const path = new URL(req.url()).pathname;
    if (path === "/api/health") return route.fulfill({ headers: CORS, contentType: "application/json", body: '{"ok":true}' });
    if (path === "/api/owners/o_test000001") {
      return route.fulfill({ headers: CORS, contentType: "application/json", body: JSON.stringify({
        owner_id: "o_test000001", source: "x", profile, needs, compares: {}, previews: {}, setups: {}, approvals: [], messages: [], active_turn: null }) });
    }
    return route.abort();
  });
}

const art = (kind: string, n?: number) => `/api/site-art?${new URLSearchParams({ site: "https://beanandbrick.example/", kind, ...(kind === "photo" ? { v: "2" } : {}), ...(n ? { n: String(n) } : {}) })}`;

test("a live owner's page shows photos and the logo from the shop's own website", async ({ page }) => {
  await liveOwner(page, "beanandbrick.example");
  // The test server can't reach the internet: answer the route with a local photo and a logo.
  await page.route("**/api/site-art?**", (route) => route.fulfill({
    path: new URL(route.request().url()).searchParams.get("kind") === "logo" ? "public/globe.svg" : "public/shops/coffee.jpg" }));
  await page.goto("/b/o_test000001");
  const about = page.getByRole("region", { name: "Your business" });
  await expect(about.getByTestId("place-photo")).toHaveAttribute("src", art("photo"));
  await expect(about.getByTestId("shop-logo")).toHaveAttribute("src", art("logo"));
  await expect(about.getByTestId("shop-logo")).toBeVisible();
  // A job we have a photo for shows that photo; a job we know nothing about shows another photo of the shop.
  const card = (name: RegExp) => page.getByRole("article", { name }).getByTestId("place-photo");
  await expect(card(/Answer questions on your website/)).toHaveAttribute("src", /^\/jobs\/website-chat(-2)?\.jpg$/);
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(card(/Keep the shelves stocked/)).toHaveAttribute("src", art("photo", 2));
});

test("without a photo on the site, the logo stands alone; without either, no empty box", async ({ page }) => {
  await liveOwner(page, "https://beanandbrick.example");
  let logo = true;
  await page.route("**/api/site-art?**", (route) => new URL(route.request().url()).searchParams.get("kind") === "logo" && logo
    ? route.fulfill({ path: "public/globe.svg" }) : route.fulfill({ status: 404, body: "none" }));
  await page.goto("/b/o_test000001");
  const about = page.getByRole("region", { name: "Your business" });
  await expect(about.getByTestId("shop-logo")).toBeVisible();
  await expect(about.getByTestId("place-photo")).toHaveCount(0);
  expect((await about.getByTestId("shop-art").boundingBox())!.height).toBeLessThan(160);
  logo = false;
  await page.reload();
  await expect(about.getByText("A coffee shop.")).toBeVisible();
  await expect(about.getByTestId("shop-art")).toHaveCount(0);
});

test("an owner with no website of their own gets no photo and no street view", async ({ page }) => {
  const asked: string[] = [];
  page.on("request", (r) => /\/api\/(street|site-art)/.test(r.url()) && asked.push(r.url()));
  await liveOwner(page, "https://www.facebook.com/beanandbrick");
  await page.goto("/b/o_test000001");
  const about = page.getByRole("region", { name: "Your business" });
  await expect(about.getByText("A coffee shop.")).toBeVisible();
  await expect(about.getByTestId("shop-art")).toHaveCount(0);
  expect(asked).toEqual([]);
});

for (const [name, path, title] of [
  ["share page", "/b/demo-coffee/shop", "Share your shop"],
  ["owner page", "/b/demo-coffee", "Bean & Brick Coffee"],
] as const) {
  test(`the ${name} has a large image link card for iMessage`, async ({ page, request }) => {
    await page.goto(path);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", title);
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
    await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute("content", "1200");
    const src = await page.locator('meta[property="og:image"]').getAttribute("content");
    expect(src).toBeTruthy();
    const img = await request.get(new URL(src!).pathname + new URL(src!).search);
    expect(img.status()).toBe(200);
    expect(img.headers()["content-type"]).toMatch(/^image\//);
    expect((await img.body()).length).toBeGreaterThan(20_000);
  });
}

test("tool cards show the tool's logo", async ({ page }) => {
  // Answer the icon service locally (any image bigger than its 16 px placeholder), so the test needs no network.
  await page.route("https://www.google.com/s2/favicons**", (route) => route.fulfill({ path: "public/shops/coffee.jpg" }));
  await page.goto("/catalog");
  const first = page.getByTestId("tool-card").first();
  await expect(first.getByTestId("tool-logo")).toHaveAttribute("src", /favicons\?domain=/);
  await expect(first.getByTestId("tool-logo")).toBeVisible();
});

// iMessage plays og:video as a muted looping preview of the link (Apple TN3156): a direct mp4 at the og:image's size.
for (const [name, path, video] of [
  ["home page", "/", "/og/home.mp4"],
  ["example owner page", "/b/demo-coffee", "/og/demo-coffee.mp4"],
  ["live owner page", "/b/o_test000001", "/og/home.mp4"],
] as const) {
  test(`the ${name} has a looping video link preview`, async ({ page, request }) => {
    await page.goto(path);
    const meta = (p: string) => page.locator(`meta[property="${p}"]`).first();
    const src = await meta("og:video").getAttribute("content");
    expect(src).toMatch(/^https:\/\//);
    expect(new URL(src!).pathname).toBe(video);
    await expect(meta("og:video:type")).toHaveAttribute("content", "video/mp4");
    await expect(meta("og:video:width")).toHaveAttribute("content", "1200");
    await expect(meta("og:video:height")).toHaveAttribute("content", "630");
    const r = await request.get(video);
    expect(r.status()).toBe(200);
    expect(r.headers()["content-type"]).toBe("video/mp4");
    expect((await r.body()).length).toBeLessThan(2_000_000);
  });
}

test("on a phone the business summary is its own section above the deck, and the deck starts on the first job", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/b/demo-coffee");
  const about = page.getByRole("region", { name: "Your business" });
  await expect(about.getByText(/Daniel Ortiz runs Bean & Brick/)).toBeVisible();
  await expect(about.locator("article")).toHaveCount(0);
  await expect(page.getByRole("article", { name: /Here's what we understood/ })).toHaveCount(0);
  await expect(page.getByRole("article", { name: /^Website chat and FAQ, 1 of / })).toBeVisible();
  const aboutBox = await about.boundingBox();
  const deckBox = await page.getByRole("region", { name: "Your cards" }).boundingBox();
  expect(aboutBox!.y + aboutBox!.height).toBeLessThanOrEqual(deckBox!.y);
});

test("the list view shows only the numbered jobs with our pick, and switches back to cards", async ({ page }) => {
  await page.goto("/b/demo-coffee");
  await page.getByRole("button", { name: "List", exact: true }).click();
  const rows = page.getByTestId("need-item");
  await expect(rows).toHaveCount(4);
  await expect(rows.first()).toContainText("Job 1");
  await expect(rows.first()).toContainText("Website chat and FAQ");
  await expect(rows.first()).toContainText("Our pick: Chatling");
  await expect(page.getByRole("list", { name: "All jobs" }).getByRole("listitem")).toHaveCount(4);
  await rows.nth(1).click();
  await expect(page.getByRole("article", { name: /^Social posts and specials, 2 of / })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cards", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("the Setup tab on an example business plays a recorded run of the setup agent, which stops at the human check", async ({ page, request }) => {
  await page.goto("/b/demo-coffee");
  await page.getByRole("button", { name: "Setup", exact: true }).click();
  const setup = page.getByRole("region", { name: "Setup" });
  const replay = setup.getByTestId("setup-replay");
  await expect(replay).toHaveAttribute("src", "/setup/chatling-signup.mp4");
  expect((await request.get("/setup/chatling-signup.mp4")).status()).toBe(200);
  await expect(setup.getByText(/Recorded run/)).toBeVisible();
  await expect(setup.getByText(/human check/).first()).toBeVisible();
  await expect(setup.getByRole("heading", { name: "Prefer a person?" })).toBeVisible();
});

test("Set it up on an example job opens the Setup tab", async ({ page }) => {
  await page.goto("/b/demo-coffee");
  await page.getByRole("button", { name: "Set it up" }).click();
  await expect(page.getByRole("button", { name: "Setup", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("region", { name: "Setup" })).toBeVisible();
});

test("job cards have two choices, Not now and Set it up, and the preview opens from the video", async ({ page }) => {
  await page.goto("/b/demo-coffee");
  const first = page.getByRole("article", { name: /^Website chat and FAQ, 1 of / });
  await expect(first.getByRole("button", { name: "Show me" })).toHaveCount(0);
  await first.getByRole("button", { name: "Not now" }).click();
  const card = page.getByRole("article", { name: /^Social posts and specials, 2 of / });
  await card.getByRole("button", { name: /Watch the preview/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("a running setup shows the agent's cloud browser live in the Setup tab", async ({ page }) => {
  const profile = { name: "Bean & Brick Coffee", business_type: "coffee_shop", city: "Frederick", state: "MD", size: "s",
    website: null, uses: [], pains: [], summary: "A coffee shop.", facts: [] };
  const needs = { items: [{ need_id: "website-chat", title: "Answer questions on your website", why: "w", est_hours_saved_week: 2 }] };
  const live = "https://live.example.test/session/abc";
  const setups = { chatling: { tool_id: "chatling", status: "running", streaming_url: live, configured: [], next_steps: [], has_password: false } };
  await page.route(`${API}/**`, async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const path = new URL(req.url()).pathname;
    if (path === "/api/health") return route.fulfill({ headers: CORS, contentType: "application/json", body: '{"ok":true}' });
    if (path === "/api/owners/o_test000001") {
      return route.fulfill({ headers: CORS, contentType: "application/json", body: JSON.stringify({
        owner_id: "o_test000001", source: "x", profile, needs, compares: {}, previews: {}, setups, approvals: [], messages: [], active_turn: null }) });
    }
    return route.abort();
  });
  await page.route("https://live.example.test/**", (route) => route.fulfill({ contentType: "text/html", body: "<p>agent browser</p>" }));
  await page.goto("/b/o_test000001");
  await expect(page.getByRole("button", { name: /Setup/ })).toContainText("Live");
  await page.getByRole("button", { name: /Setup/ }).click();
  const setup = page.getByRole("region", { name: "Setup" });
  await expect(setup.locator("iframe")).toHaveAttribute("src", live);
  await expect(setup.getByRole("link", { name: /Open full screen/ })).toHaveAttribute("href", live);
});
