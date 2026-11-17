import { test, expect, type Page } from "@playwright/test";

const API = "http://127.0.0.1:9";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};
const A = "https://live.example.test/session/a";
const B = "https://live.example.test/session/b";

type Setup = Record<string, unknown>;
async function owner(page: Page, setups: Record<string, Setup>) {
  const profile = { name: "Bean & Brick Coffee", business_type: "coffee_shop", city: "Frederick", state: "MD", size: "s",
    website: null, uses: [], pains: [], summary: "A coffee shop.", facts: [] };
  const needs = { items: [{ need_id: "website-chat", title: "Answer questions on your website", why: "w", est_hours_saved_week: 2 }] };
  await page.route(`${API}/**`, async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const path = new URL(req.url()).pathname;
    if (path === "/api/health") return route.fulfill({ headers: CORS, contentType: "application/json", body: '{"ok":true}' });
    if (path === "/api/owners/o_test000002") {
      return route.fulfill({ headers: CORS, contentType: "application/json", body: JSON.stringify({
        owner_id: "o_test000002", source: "x", profile, needs, compares: {}, previews: {}, setups, approvals: [], messages: [], active_turn: null }) });
    }
    return route.abort();
  });
  await page.route("https://live.example.test/**", (route) => route.fulfill({ contentType: "text/html", body: "<p>agent browser</p>" }));
}
const rec = (id: string, extra: Setup = {}): Setup => ({ tool_id: id, status: "running", configured: [], next_steps: [], has_password: false, ...extra });

test("the live window is view-only", async ({ page }) => {
  await owner(page, { chatling: rec("chatling", { streaming_url: A }) });
  await page.goto("/b/o_test000002#setup");
  const frame = page.locator("iframe");
  await expect(frame).toHaveAttribute("src", A);
  const wrap = page.locator("div[inert]").filter({ has: frame });
  await expect(wrap).toHaveCount(1);
  expect(await wrap.evaluate((e) => getComputedStyle(e).pointerEvents)).toBe("none");
  expect(await frame.evaluate((e) => getComputedStyle(e).pointerEvents)).toBe("none");
  await expect(frame).toHaveAttribute("tabindex", "-1");
  await expect(frame).toHaveAttribute("allow", "autoplay");
});

test("two live windows sit side by side on a wide screen", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await owner(page, { chatling: rec("chatling", { streaming_url: A }), cal: rec("cal", { streaming_url: B }) });
  await page.goto("/b/o_test000002#setup");
  const frames = page.locator("iframe");
  await expect(frames).toHaveCount(2);
  const a = (await frames.nth(0).boundingBox())!;
  const b = (await frames.nth(1).boundingBox())!;
  expect(Math.abs(a.y - b.y)).toBeLessThan(2);
  expect(a.x + a.width).toBeLessThanOrEqual(b.x + 1);
});

test("#setup opens the Setup tab", async ({ page }) => {
  await owner(page, {});
  await page.goto("/b/o_test000002#setup");
  await expect(page.getByRole("button", { name: "Setup", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("region", { name: "Setup" })).toBeVisible();
});

test("a finished setup shows its booking page and no login details", async ({ page }) => {
  await owner(page, { cal: rec("cal", { status: "done", links: { booking_page: "https://cal.example.test/shop" }, login_url: "https://cal.example.test/login", username: "agent@x.test" }) });
  await page.goto("/b/o_test000002#setup");
  const setup = page.getByRole("region", { name: "Setup" });
  await expect(setup.getByRole("link", { name: "Your booking page" })).toHaveAttribute("href", "https://cal.example.test/shop");
  await expect(setup.getByText("Username")).toHaveCount(0);
  await expect(setup.getByText("Password")).toHaveCount(0);
  await expect(setup.getByText("Log in at")).toHaveCount(0);
});

test("a running setup without a stream says the browser is starting", async ({ page }) => {
  await owner(page, { chatling: rec("chatling") });
  await page.goto("/b/o_test000002#setup");
  await expect(page.getByText("Starting the browser…")).toBeVisible();
});
