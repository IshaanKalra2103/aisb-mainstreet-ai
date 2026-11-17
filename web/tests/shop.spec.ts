import { test, expect, type Page } from "@playwright/test";

// The share page posts one turn to the API (NEXT_PUBLIC_AGENT_API_URL is http://127.0.0.1:9 in tests).
const TURNS = "http://127.0.0.1:9/api/owners/o-test/turns";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
const LINK_LABEL = "Your website, Google Maps or Instagram link";

/** Record the text of every turn the page posts; answer with `reply` (default: one accepted turn). */
async function recordTurns(page: Page, reply: { status?: number; body?: unknown; delayMs?: number } = {}) {
  const texts: string[] = [];
  await page.route(TURNS, async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    texts.push(req.postDataJSON().text);
    if (reply.delayMs) await new Promise((r) => setTimeout(r, reply.delayMs));
    await route.fulfill({
      status: reply.status ?? 200,
      headers: CORS,
      contentType: "application/json",
      body: JSON.stringify(reply.body ?? { turn_id: "t1" }),
    });
  });
  return texts;
}

test.describe("with location allowed", () => {
  test.use({
    geolocation: { latitude: 39.57501, longitude: -76.99531, accuracy: 20 },
    permissions: ["geolocation"],
  });

  test("shares link and location", async ({ page }) => {
    const texts = await recordTurns(page);
    await page.goto("/b/o-test/shop");
    await expect(page).toHaveTitle("Share your shop | MainStreet AI");
    // iMessage cards read og:title; the layout's "MainStreet AI" must not leak through.
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", "Share your shop");
    await page.getByRole("button", { name: "Use my location" }).click();
    await expect(page.getByText("Location added")).toBeVisible();
    await page.getByLabel(LINK_LABEL).fill("mainstreetshears.com");
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await expect(page).toHaveURL(/\/b\/o-test$/);
    expect(texts).toEqual([
      "Here is my shop. Location: 39.57501, -76.99531 (within 20 m). Link: https://mainstreetshears.com",
    ]);
  });

  test("a typed handle that is not a link is never dropped silently", async ({ page }) => {
    const texts = await recordTurns(page);
    await page.goto("/b/o-test/shop");
    await page.getByRole("button", { name: "Use my location" }).click();
    await expect(page.getByText("Location added")).toBeVisible();
    await page.getByLabel(LINK_LABEL).fill("@mainstreetshears");
    await expect(page.getByText("That doesn't look like a web address. Paste the full link, or clear it.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Share", exact: true })).toBeDisabled();
    await page.getByLabel(LINK_LABEL).fill("");
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await expect(page).toHaveURL(/\/b\/o-test$/);
    expect(texts).toEqual(["Here is my shop. Location: 39.57501, -76.99531 (within 20 m). Link: none"]);
  });
});

test("works with the link alone when location is denied", async ({ page }) => {
  const texts = await recordTurns(page);
  await page.goto("/b/o-test/shop");
  await page.getByRole("button", { name: "Use my location" }).click();
  await expect(page.getByText("Location is off. Your link is enough.")).toBeVisible();
  await page.getByLabel(LINK_LABEL).fill("https://example.com/shop");
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await expect(page).toHaveURL(/\/b\/o-test$/);
  expect(texts).toEqual(["Here is my shop. Location: not shared. Link: https://example.com/shop"]);
});

test("double tap posts once", async ({ page }) => {
  const texts = await recordTurns(page, { delayMs: 500 });
  await page.goto("/b/o-test/shop");
  await page.getByLabel(LINK_LABEL).fill("https://example.com/shop");
  await page.getByRole("button", { name: "Share", exact: true }).dblclick();
  await expect(page).toHaveURL(/\/b\/o-test$/);
  expect(texts).toHaveLength(1);
});

test("busy owner sees the API text", async ({ page }) => {
  const detail = "One thing at a time: I'm still working on your last message.";
  await recordTurns(page, { status: 429, body: { detail } });
  await page.goto("/b/o-test/shop");
  await page.getByLabel(LINK_LABEL).fill("https://example.com/shop");
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await expect(page.getByText(detail)).toBeVisible();
  await expect(page).toHaveURL(/\/b\/o-test\/shop$/);
});

test("Share is disabled with nothing given", async ({ page }) => {
  const texts = await recordTurns(page);
  await page.goto("/b/o-test/shop");
  await expect(page.getByRole("button", { name: "Share", exact: true })).toBeDisabled();
  await page.getByRole("link", { name: "Skip for now" }).click();
  await expect(page).toHaveURL(/\/b\/o-test$/);
  expect(texts).toHaveLength(0);
});
