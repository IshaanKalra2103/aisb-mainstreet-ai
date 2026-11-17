import { test, expect, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

// The 2026-11-17 UI pass: the Ask us button, deck order, job card media, the preview sheet, the catalog order,
// comparisons for every example job, readable example cards, tool page wording and the disabled Share button.

type Tool = {
  id: string; name: string; vendor: string; need_ids: string[]; business_types: string[]; integrations: string[];
  status: string; trust: { badge: string; score: number };
};
type Demo = {
  profile: { business_type: string };
  needs: { items: Array<{ need_id: string; title: string }> };
  compares: Record<string, { options: Array<{ tool_id: string; works_with: string[] }>; recommended_tool_id: string } | undefined>;
  messages: Array<{ role: string; text: string }>;
};
const SLUGS = ["coffee", "diner", "hvac", "landscaping", "salon"] as const;
const tools: Tool[] = JSON.parse(readFileSync("data/catalog.json", "utf8")).tools;
const demo = (slug: string): Demo => JSON.parse(readFileSync(`data/demo/${slug}.json`, "utf8"));
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

// 1. The Ask us button
for (const mode of ["List", "Setup"]) {
  test(`on a phone in ${mode} mode nothing floats over the page, and Ask us sits by the tabs`, async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto("/b/demo-coffee");
    await page.getByRole("button", { name: mode, exact: true }).click();
    await expect(page.getByRole("button", { name: "Ask us a question" })).toBeHidden();
    const ask = page.getByRole("button", { name: "Ask us", exact: true });
    await expect(ask).toBeVisible();
    await ask.click();
    await expect(page.getByRole("dialog", { name: "Ask us anything" })).toBeVisible();
  });
}

test("on a computer the Ask us button sits at the bottom right and hides while a sheet is open", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/b/demo-coffee");
  const ask = page.getByRole("button", { name: "Ask us a question" });
  const box = (await ask.boundingBox())!;
  expect(DESKTOP.width - (box.x + box.width)).toBeLessThan(40);
  expect(DESKTOP.height - (box.y + box.height)).toBeLessThan(40);
  await ask.click();
  const sheet = page.getByRole("dialog", { name: "Ask us anything" });
  await expect(sheet).toBeVisible();
  await expect(ask).toBeHidden();
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(ask).toBeVisible();
});

// 2. The deck opens on the job the chat recommends
for (const slug of SLUGS) {
  test(`${slug}: the deck opens on the job the chat says to try first`, async ({ page }) => {
    const d = demo(slug);
    const first = d.needs.items[0];
    const reply = d.messages.find((m) => m.role === "agent")!.text;
    const at = (t: Tool) => reply.search(new RegExp(`\\b${esc(t.name)}\\b`));
    const named = tools.filter((t) => at(t) >= 0).sort((a, b) => at(a) - at(b));
    expect(named[0]?.id, "the first tool the chat names is job 1's pick").toBe(d.compares[first.need_id]?.recommended_tool_id);
    await page.goto(`/b/demo-${slug}`);
    await expect(page.getByRole("article", { name: new RegExp(`^${esc(first.title)}, 1 of `) })).toBeVisible();
  });
}

// 3. Job card media is 16:9, and only the job number and the preview button sit on it
for (const vp of [PHONE, DESKTOP]) {
  test(`at ${vp.width} px the job card's media is 16:9 and the hours line sits below it`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.goto("/b/demo-coffee");
    const card = page.getByRole("article", { name: /, 1 of / });
    const m = (await card.getByTestId("card-media").boundingBox())!;
    expect(m.width / m.height).toBeCloseTo(16 / 9, 1);
    const hours = card.getByTestId("card-hours");
    await expect(hours).toHaveText(/^About \d+ hours? a week$/);
    expect((await hours.boundingBox())!.y).toBeGreaterThanOrEqual(m.y + m.height);
  });
}

// 4. The preview sheet on a phone is the shape of the video, not a tall black box
test("on a phone the preview sheet's player is the shape of the video", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/b/demo-coffee");
  await page.getByRole("button", { name: "List", exact: true }).click();
  await page.getByTestId("need-item").filter({ hasText: "Social posts and specials" }).click();
  await page.getByRole("article", { name: /^Social posts and specials, / }).getByRole("button", { name: /Watch the preview/ }).click();
  const video = page.getByRole("dialog").locator("video");
  await expect(video).toBeVisible();
  const { bw, bh } = await video.evaluate((v: HTMLVideoElement) => ({ bw: v.clientWidth, bh: v.clientHeight }));
  expect(bw / bh).toBeCloseTo(1280 / 720, 1); // every preview clip is 1280x720
});

// 5. The catalog: verified and best-scored first, a page at a time
const rank: Record<string, number> = { verified: 0, caution: 1, unknown: 2 };
const listed = tools
  .filter((t) => t.status === "approved" && t.trust.badge !== "unknown")
  .sort((a, b) => rank[a.trust.badge] - rank[b.trust.badge] || b.trust.score - a.trust.score || a.name.localeCompare(b.name));

test("the catalog lists verified tools first, highest score first, and shows the rest on request", async ({ page }) => {
  await page.goto("/catalog");
  await expect(page.getByText(`${listed.length} tools`, { exact: true })).toBeVisible();
  const cards = page.getByTestId("tool-card");
  const n = await cards.count();
  expect(n).toBeGreaterThan(0);
  expect(n).toBeLessThan(listed.length);
  const names = await cards.locator("h3").allInnerTexts();
  expect(names.map((s) => s.trim())).toEqual(listed.slice(0, n).map((t) => t.name));
  const more = page.getByRole("button", { name: /^Show \d+ more tools?$/ });
  while (await more.isVisible()) await more.click();
  await expect(cards).toHaveCount(listed.length);
});

// 6. Every example job has a comparison of real catalog tools
for (const slug of SLUGS) {
  test(`${slug}: every job compares real catalog tools for that job and business`, async ({ page }) => {
    const d = demo(slug);
    for (const it of d.needs.items) {
      const c = d.compares[it.need_id];
      expect(c, `${it.need_id} has a comparison`).toBeTruthy();
      expect(c!.options.length).toBeGreaterThanOrEqual(2);
      expect(c!.options.map((o) => o.tool_id)).toContain(c!.recommended_tool_id);
      for (const o of c!.options) {
        const t = tools.find((x) => x.id === o.tool_id);
        expect(t, o.tool_id).toBeTruthy();
        expect(t!.need_ids).toContain(it.need_id);
        expect(t!.business_types).toContain(d.profile.business_type);
        for (const w of o.works_with) expect(t!.integrations).toContain(w);
      }
    }
    await page.goto(`/b/demo-${slug}`);
    await page.getByRole("button", { name: "List", exact: true }).click();
    await expect(page.getByTestId("need-item")).toHaveCount(d.needs.items.length);
    await expect(page.getByText("Not compared yet")).toHaveCount(0);
  });
}

// 7. The eyebrow on each example card is readable over its photo (WCAG AA for small text: 4.5:1)
const lum = (c: number[]) => {
  const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
/** The 5th-percentile contrast of the tile's eyebrow text against the pixels behind it. */
async function eyebrowContrast(page: Page, tile: Locator): Promise<number> {
  await tile.scrollIntoViewIfNeeded();
  await expect.poll(() => tile.locator("img").evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBeGreaterThan(0);
  const eyebrow = tile.locator("p").first();
  const [r, g, b, a] = await eyebrow.evaluate((e) => {
    // Through a canvas, so oklab() and color-mix() colours come back as sRGB.
    const x = document.createElement("canvas").getContext("2d")!;
    x.fillStyle = getComputedStyle(e).color;
    x.fillRect(0, 0, 1, 1);
    const d = x.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  });
  // The text itself, not the full-width row under it.
  const box = await eyebrow.evaluate((e) => {
    const range = document.createRange();
    range.selectNodeContents(e);
    const r = range.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  await tile.evaluate((t) => t.querySelectorAll("p").forEach((p) => ((p as HTMLElement).style.visibility = "hidden")));
  const png = (await page.screenshot({ clip: box })).toString("base64");
  await tile.evaluate((t) => t.querySelectorAll("p").forEach((p) => ((p as HTMLElement).style.visibility = "")));
  const px: number[][] = await page.evaluate(async (src) => {
    const img = new Image();
    img.src = `data:image/png;base64,${src}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const x = c.getContext("2d")!;
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    const out: number[][] = [];
    for (let i = 0; i < d.length; i += 16) out.push([d[i], d[i + 1], d[i + 2]]);
    return out;
  }, png);
  const ratios = px.map((bg) => {
    const fg = [r, g, b].map((v, i) => a * v + (1 - a) * bg[i]);
    const [hi, lo] = [lum(fg), lum(bg)].sort((p, q) => q - p);
    return (hi + 0.05) / (lo + 0.05);
  }).sort((p, q) => p - q);
  return ratios[Math.floor(ratios.length * 0.05)];
}

for (const path of ["/demo", "/"]) {
  test(`the example cards' labels on ${path} are readable over the street photos`, async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto(path);
    for (const slug of SLUGS) {
      const tile = page.locator(`a[href="/b/demo-${slug}"]:visible`).first();
      expect(await eyebrowContrast(page, tile), slug).toBeGreaterThanOrEqual(4.5);
    }
  });
}

// 8. Tool page wording
test("the tool page reads cleanly: one period, a plain date, sentence-case checks, short source links", async ({ page }) => {
  await page.goto("/tool/chatling");
  const text = await page.locator("body").innerText();
  expect(text).toContain("Made by Envision Labs Inc. Visit their site");
  expect(text).not.toMatch(/[^.]\.\.(?!\.)/);
  await expect(page.getByText(/^Reviewed by .+ on November 9, 2026$/)).toBeVisible();
  expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T\d/);
  expect(text).not.toContain("(simulated)");
  await expect(page.getByText("Honest pricing", { exact: true })).toBeVisible();
  await expect(page.getByText("Independent reviews", { exact: true })).toBeVisible();
  const sources = page.getByRole("region", { name: "Where our information comes from" }).getByRole("link");
  expect(await sources.count()).toBeGreaterThan(0);
  for (const s of await sources.allInnerTexts()) expect(s).not.toMatch(/^https?:\/\//);
});

// 9. The disabled Share button is grey, not a dimmed lime
async function shownColor(button: Locator): Promise<number[]> {
  return button.evaluate((el) => {
    const x = document.createElement("canvas").getContext("2d")!;
    const rgb = (s: string) => {
      x.clearRect(0, 0, 1, 1);
      x.fillStyle = s;
      x.fillRect(0, 0, 1, 1);
      const d = x.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3] / 255];
    };
    let under: Element | null = el.parentElement;
    let bg = [255, 255, 255];
    while (under) {
      const c = rgb(getComputedStyle(under).backgroundColor);
      if ((c[3] ?? 1) > 0) { bg = c.slice(0, 3); break; }
      under = under.parentElement;
    }
    const [r, g, b, a = 1] = rgb(getComputedStyle(el).backgroundColor);
    const o = Number(getComputedStyle(el).opacity) * a;
    return [r, g, b].map((v, i) => Math.round(o * v + (1 - o) * bg[i]));
  });
}

test("the Share button is grey while there is nothing to share, and lime once there is", async ({ page }) => {
  await page.goto("/b/demo-coffee/shop");
  const share = page.getByRole("button", { name: "Share", exact: true });
  await expect(share).toBeDisabled();
  const off = await shownColor(share);
  expect(Math.max(...off) - Math.min(...off), `disabled colour ${off}`).toBeLessThan(16);
  await page.getByPlaceholder("yourshop.com").fill("beanandbrick.com");
  await expect(share).toBeEnabled();
  expect(await shownColor(share)).toEqual([215, 255, 58]);
});
