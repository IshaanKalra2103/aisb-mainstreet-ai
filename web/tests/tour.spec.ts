import { test, expect, type Page } from "@playwright/test";
import { TOURS } from "../data/demo/tours";
import coffee from "../data/demo/coffee.json";
import diner from "../data/demo/diner.json";
import hvac from "../data/demo/hvac.json";
import landscaping from "../data/demo/landscaping.json";
import salon from "../data/demo/salon.json";

const bundles: Record<string, { messages: { text: string }[] }> = { coffee, diner, hvac, landscaping, salon };
const flat = (s: string) => s.replace(/\s+/g, " ").trim();

test("every run line in a tour is word for word from that example's saved messages", () => {
  for (const [slug, steps] of Object.entries(TOURS)) {
    expect(steps, slug).toHaveLength(7);
    const all = flat(bundles[slug].messages.map((m) => m.text).join(" "));
    for (const s of steps) {
      for (const t of [s.run?.owner, s.run?.agent]) if (t) expect(all, `${slug}/${s.id}: ${t}`).toContain(flat(t));
    }
  }
});

type Box = { x: number; y: number; width: number; height: number };
const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

async function landed(page: Page, n: number, total = 7) {
  const o = page.locator("[data-tour-overlay]");
  await expect(o.getByText(`Step ${n} of ${total}`)).toBeVisible();
  // The run replays first; Skip jumps to the end of it.
  const skip = o.getByRole("button", { name: "Skip replay" });
  if (n > 1 && (await skip.count())) await skip.click({ timeout: 2000 }).catch(() => {});
  await expect(o).toHaveAttribute("data-phase", "landed", { timeout: 15_000 });
  await page.waitForTimeout(500); // the spotlight glides in
}

for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  test(`tour walks 7 steps at ${vp.width}x${vp.height}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(vp);
    await page.goto("/b/demo-coffee?tour=1");
    const o = page.locator("[data-tour-overlay]");
    await expect(o).toBeVisible();
    for (let n = 1; n <= 7; n++) {
      await landed(page, n);
      const spot = (await page.locator("[data-tour-spot]").boundingBox())!;
      const card = (await page.locator("[data-tour-card]").boundingBox())!;
      expect(spot, `step ${n} spot`).toBeTruthy();
      // the highlight is on screen, and the note never sits on it
      expect(spot.y).toBeGreaterThanOrEqual(-1);
      expect(spot.y + spot.height).toBeLessThanOrEqual(vp.height + 1);
      expect(spot.x).toBeGreaterThanOrEqual(-1);
      expect(spot.x + spot.width).toBeLessThanOrEqual(vp.width + 1);
      expect(spot.width * spot.height).toBeGreaterThan(2000);
      expect(overlap(spot, card), `step ${n}: note covers the highlight`).toBe(0);
      await page.screenshot({ path: `${process.env.TOUR_SHOTS ?? "test-results/tour"}/${vp.width}-step${n}.png` });
      if (n === 4) {
        await expect(page.getByRole("dialog", { name: /^Tools for/ })).toBeVisible();
        await expect(page.getByText("Who is behind it").first()).toBeVisible();
      }
      if (n === 5) await expect(page.getByRole("dialog", { name: /at work$/ })).toBeVisible();
      if (n < 7) await o.getByRole("button", { name: "Next" }).click();
    }
    await o.getByRole("button", { name: "Done" }).click();
    await expect(page.locator("[data-tour-overlay]")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test(`Esc closes the tour and its sheet mid-step at ${vp.width}x${vp.height}`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.goto("/b/demo-coffee?tour=1");
    const o = page.locator("[data-tour-overlay]");
    for (let n = 1; n <= 4; n++) { await landed(page, n); await o.getByRole("button", { name: "Next" }).click(); }
    await expect(o.getByText("Step 5 of 7")).toBeVisible(); // preview sheet opening, replay running
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-tour-overlay]")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // the page scrolls and clicks normally again
    await page.getByRole("button", { name: "List", exact: true }).click();
    await expect(page.getByTestId("need-item").first()).toBeVisible();
  });
}

test("X closes the tour", async ({ page }) => {
  await page.goto("/b/demo-coffee?tour=1");
  await page.locator("[data-tour-overlay]").getByRole("button", { name: "Close the tour" }).click();
  await expect(page.locator("[data-tour-overlay]")).toHaveCount(0);
});

test("reduced motion: the run shows at once", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/b/demo-coffee?tour=1");
  const o = page.locator("[data-tour-overlay]");
  await expect(o).toHaveAttribute("data-phase", "landed", { timeout: 4000 });
  await expect(o.getByText(TOURS.coffee[0].run!.agent)).toBeVisible();
});

test("Take the tour button: on examples, not on a live owner page", async ({ page }) => {
  await page.goto("/b/demo-coffee");
  await page.getByRole("button", { name: "Take the tour" }).click();
  await expect(page.locator("[data-tour-overlay]")).toBeVisible();
  await page.goto("/b/o_abcdef123456");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Take the tour" })).toHaveCount(0);
});

for (const slug of ["diner", "hvac", "landscaping", "salon"]) {
  test(`${slug}: the tour reaches its last step`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(`/b/demo-${slug}?tour=1`);
    const o = page.locator("[data-tour-overlay]");
    for (let n = 1; n <= 7; n++) {
      await landed(page, n);
      const spot = (await page.locator("[data-tour-spot]").boundingBox())!;
      expect(spot.width * spot.height).toBeGreaterThan(2000);
      if (n < 7) await o.getByRole("button", { name: "Next" }).click();
    }
    await o.getByRole("button", { name: "Done" }).click();
    await expect(page.locator("[data-tour-overlay]")).toHaveCount(0);
  });
}
