import { test, expect } from "@playwright/test";

// Photos of the shop's street (Google Street View) on the cards, and link cards with a big image for iMessage.
const API = "http://127.0.0.1:9";
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST" };

test("each example business shows a photo of its street", async ({ page }) => {
  await page.goto("/demo");
  for (const slug of ["diner", "coffee", "hvac", "landscaping", "salon"]) {
    const img = page.locator(`a[href="/b/demo-${slug}"] img`);
    await expect(img).toHaveAttribute("src", `/places/${slug}/hero.jpg`);
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  }
});

test("the home page shows the example streets", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('a[href="/b/demo-coffee"] img').first()).toHaveAttribute("src", "/places/coffee/hero.jpg");
});

test("an example owner page shows the shop's street on the profile and a different view on each job", async ({ page }) => {
  await page.goto("/b/demo-coffee");
  const card = (name: RegExp) => page.getByRole("article", { name }).getByTestId("place-photo");
  await expect(card(/Here's what we understood/)).toHaveAttribute("src", "/places/coffee/hero.jpg");
  // Job 1 of coffee has a preview video; job 2 has none, so it shows a photo of another view of the street.
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(card(/Website chat and FAQ/)).toHaveAttribute("src", "/places/coffee/job-2.jpg");
});

test("a live owner's photos come from the street photo route, at the shared location", async ({ page }) => {
  const profile = { name: "Bean & Brick Coffee", business_type: "coffee_shop", city: "Frederick", state: "MD", size: "s",
    website: null, uses: [], pains: [], summary: "A coffee shop.", facts: [], lat: 39.4143, lon: -77.4105 };
  const needs = { items: [{ need_id: "website-chat", title: "Answer questions on your website", why: "w", est_hours_saved_week: 2 }] };
  await page.route(`${API}/**`, async (route) => {
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
  // The test server has no Maps key, so the real route 404s and the photo removes itself; answer it with a local photo.
  await page.route("**/api/street?**", (route) => route.fulfill({ path: "public/places/coffee/hero.jpg" }));
  await page.goto("/b/o_test000001");
  const card = (name: RegExp) => page.getByRole("article", { name }).getByTestId("place-photo");
  await expect(card(/Here's what we understood/)).toHaveAttribute("src", "/api/street?lat=39.41430&lon=-77.41050");
  await page.keyboard.press("ArrowRight");
  await expect(card(/Answer questions on your website/)).toHaveAttribute("src", "/api/street?lat=39.41430&lon=-77.41050&view=1");
});

test("the street photo route refuses requests without a place", async ({ request }) => {
  const r = await request.get("/api/street");
  expect([400, 404]).toContain(r.status());
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
  await page.route("https://www.google.com/s2/favicons**", (route) => route.fulfill({ path: "public/places/coffee/hero.jpg" }));
  await page.goto("/catalog");
  const first = page.getByTestId("tool-card").first();
  await expect(first.getByTestId("tool-logo")).toHaveAttribute("src", /favicons\?domain=/);
  await expect(first.getByTestId("tool-logo")).toBeVisible();
});
