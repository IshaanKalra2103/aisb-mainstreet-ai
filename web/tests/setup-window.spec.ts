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
async function owner(page: Page, setups: Record<string, Setup>, extra: Record<string, unknown> = {}) {
  const profile = { name: "Bean & Brick Coffee", business_type: "coffee_shop", city: "Frederick", state: "MD", size: "s",
    website: null, uses: [], pains: [], summary: "A coffee shop.", facts: [] };
  const needs = { items: [{ need_id: "website-chat", title: "Answer questions on your website", why: "w", est_hours_saved_week: 2 }] };
  await page.route(`${API}/**`, async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const path = new URL(req.url()).pathname;
    if (path === "/api/health") return route.fulfill({ headers: CORS, contentType: "application/json", body: '{"ok":true}' });
    if (path === "/api/owners/o_test000002/link") return route.fulfill({ headers: CORS, contentType: "application/json", body: '{"code":"UZDXTB","linked":false}' });
    if (path === "/api/owners/o_test000002") {
      return route.fulfill({ headers: CORS, contentType: "application/json", body: JSON.stringify({
        owner_id: "o_test000002", source: "x", profile, needs, compares: {}, previews: {}, setups, approvals: [], messages: [], active_turn: null, ...extra }) });
    }
    return route.abort();
  });
  await page.route("https://live.example.test/**", (route) => route.fulfill({ contentType: "text/html", body: "<p>agent browser</p>" }));
  await page.route("https://media.example.test/**", (route) => route.fulfill({ contentType: "video/mp4", body: "" }));
  await page.route("https://share.chatling.test/**", (route) => route.fulfill({ contentType: "text/html", body: "<p>your chatbot</p>" }));
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

test("one live window uses the full width on a wide screen", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await owner(page, { chatling: rec("chatling", { streaming_url: A }) });
  await page.goto("/b/o_test000002#setup");
  const frame = (await page.locator("iframe").boundingBox())!;
  const panel = (await page.locator("figure", { has: page.locator("iframe") }).locator("xpath=..").boundingBox())!;
  expect(frame.width).toBeGreaterThan(panel.width - 4); // not half of it
  await expect(page.getByText("Live: Chatling")).toBeVisible();
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

const CHAT = "https://share.chatling.test/s/abc";
const doneChat = () => ({ chatling: rec("chatling", { status: "done", links: { chat_page: CHAT }, configured: ["chatbot Bean & Brick"] }) });

for (const width of [1280, 390]) {
  test(`a finished chatbot points to the Sandbox tab, which runs it live (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await owner(page, doneChat());
    await page.goto("/b/o_test000002#setup");
    await expect(page.getByTestId("sandbox-new")).toBeVisible();
    await page.getByTestId("try-in-sandbox").click();
    await expect(page.getByRole("button", { name: "Sandbox", exact: true })).toHaveAttribute("aria-pressed", "true");
    const sandbox = page.getByRole("region", { name: "Sandbox" });
    await expect(sandbox.getByTestId("sandbox-live")).toHaveAttribute("src", CHAT);
    await expect(sandbox.getByText("works only for Chatling for now").first()).toBeVisible();
    await expect(page.getByTestId("sandbox-new")).toHaveCount(0);
    // Nothing on the page is wider than the phone.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const frame = (await sandbox.getByTestId("sandbox-live").boundingBox())!;
    expect(frame.x).toBeGreaterThanOrEqual(0);
    expect(frame.x + frame.width).toBeLessThanOrEqual(width);
  });
}

test("the iMessage card is a pill that opens the shop code in a sheet, clear of Ask us on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await owner(page, {});
  await page.goto("/b/o_test000002");
  await expect(page.getByTestId("shop-code")).toHaveCount(0); // not on the page itself any more
  const pill = page.getByTestId("text-pill");
  await expect(pill).toBeVisible();
  const ask = page.getByRole("button", { name: "Ask us a question" });
  if (await ask.isVisible()) {
    const a = (await page.getByTestId("text-pill-wrap").boundingBox())!, b = (await ask.boundingBox())!;
    expect(a.x + a.width).toBeLessThan(b.x);
  }
  await pill.click();
  const sheet = page.getByRole("dialog", { name: "Text us on iMessage" });
  await expect(sheet.getByTestId("shop-code")).toHaveText("UZDXTB");
  await expect(pill).toHaveCount(0);
});

test("the chat shows a finished preview under the reply that talks about it, with a way to the Sandbox", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const previews = { chatling: { tool_id: "chatling", prompt: "p", status: "completed", kind: "site", cost_usd: 0.3, video_url: "https://media.example.test/chatling.mp4" } };
  const messages = [
    { role: "owner", text: "Show me a preview", channel: "web", at: "2026-11-17T20:00:00Z" },
    { role: "agent", text: "I'm building a short preview of Chatling.", channel: "web", at: "2026-11-17T20:00:05Z" },
    { role: "agent", text: "Your preview is ready. It shows Chatling on a copy of your homepage.", channel: "web", at: "2026-11-17T20:01:00Z" },
  ];
  await owner(page, {}, { previews, messages });
  await page.goto("/b/o_test000002");
  await expect(page.getByRole("button", { name: "Sandbox", exact: true })).toBeVisible(); // the bundle is in
  await page.locator("button:visible", { hasText: "Ask us" }).first().click();
  const chat = page.getByRole("dialog", { name: "Ask us anything" });
  await expect(chat.getByTestId("chat-preview")).toHaveCount(1); // only under the last message about it
  await expect(chat.getByTestId("chat-preview").locator("video")).toHaveAttribute("src", /chatling\.mp4/);
  await chat.getByRole("button", { name: "Open the Sandbox tab" }).click();
  await expect(chat).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sandbox", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("region", { name: "Sandbox" }).locator("video")).toHaveCount(1);
});

test("the iMessage pill's x hides it for the rest of the visit", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await owner(page, {});
  await page.goto("/b/o_test000002");
  await expect(page.getByTestId("text-pill")).toBeVisible();
  await page.getByRole("button", { name: "Hide the iMessage button for this visit" }).click();
  await expect(page.getByTestId("text-pill")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Cards", exact: true })).toBeVisible();
  await expect(page.getByTestId("text-pill")).toHaveCount(0); // still gone in this tab
});

test("each kind of preview gets an honest caption in the Sandbox", async ({ page }) => {
  const v = (n: string) => `https://media.example.test/${n}.mp4`;
  const previews = {
    chatling: { tool_id: "chatling", prompt: "Recorded run-through of the tool on a copy of the shop's homepage", status: "completed", kind: "site", cost_usd: 0, video_url: v("a") },
    // saved before the "shop" kind existed: marked site, but it has a Veo opener, so it is the in-shop view
    square: { tool_id: "square", prompt: "Recorded run-through (with a Veo opener of the shop's own photo)", status: "completed", kind: "site", cost_usd: 0, video_url: v("b") },
    hellobooks: { tool_id: "hellobooks", prompt: "a scene", status: "completed", kind: "plain", cost_usd: 0.3, video_url: v("c") },
  };
  await owner(page, {}, { previews });
  await page.goto("/b/o_test000002");
  await page.getByRole("button", { name: "Sandbox", exact: true }).click();
  const box = page.getByRole("region", { name: "Sandbox" });
  await expect(box.getByText(/on a copy of your website\./)).toHaveCount(1);
  await expect(box.getByText(/on its own screen in your shop\. The opening shot of your shop is AI-generated\./)).toHaveCount(1);
  await expect(box.getByText(/^AI-generated preview of how/)).toHaveCount(1);
});
