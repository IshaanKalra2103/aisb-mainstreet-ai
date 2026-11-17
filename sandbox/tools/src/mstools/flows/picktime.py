"""Picktime: free account (plain email + password, no verification mail) -> set up business -> one service -> booking page.

Recorded 2026-11-16 (traces/picktime.md). Quirks: a chat widget can cover the Register button, a pricing-plans modal
and a news feed pop up on the first app screen (closed, never upgraded), and the account starts with a
"Sample Service" that we rename instead of adding a new one.
"""
import re
import secrets

NAME, DEFAULT_BIZ, TYPICAL_S = "Picktime booking page", "hvac", 60
PROXY = "us"  # without the residential proxy Picktime refuses: "We couldn't create your account" (2026-11-17)

INDUSTRIES = {"HVAC repair": "HVAC Services"}


async def _close(loc, p):
    try:
        await loc.first.click(timeout=1_500)
    except Exception:
        await loc.first.evaluate("e => e.click()")  # covered by another overlay: click via the DOM
    await p.wait_for_timeout(600)


async def dismiss_popups(p):
    """Close the pricing-plans modal and news feed if they show up (never click UPGRADE)."""
    for _ in range(2):
        closed = False
        for sel in ("#premiumModal.in .cross.close", ".notif-close-btn", ".newsfeed-close-btn"):
            btn = p.locator(sel)
            if await btn.count() and await btn.first.is_visible():
                await _close(btn, p)
                closed = True
        if not closed:
            return


async def run(ctx):
    p, b = ctx.page, ctx.biz
    svc = b.get("service") or {"name": "Free estimate visit", "minutes": 60}
    street = b["address"].split(",")[0].strip()
    m = re.search(r",\s*([^,]+),\s*([A-Z]{2})\s*(\d{5})?", b["address"])
    city, state, zipc = (m.group(1), m.group(2), m.group(3) or "") if m else (b["city"].split(",")[0], "", "")
    slug = re.sub(r"[^a-z0-9]", "", b["name"].lower())[:40]

    await p.goto("https://www.picktime.com/register")
    await p.locator("#reg_email").wait_for()
    await ctx.step("open sign-up page")

    await p.locator("#reg_firstname").fill(f"{b['first']} Team")
    await p.locator("#reg_email").fill(ctx.email)
    await p.locator("#reg_password").fill(ctx.password)
    await p.locator("#reg_confirmPassword").fill(ctx.password)
    await ctx.step("fill sign-up form (email + password, no Google)")

    close_chat = p.get_by_role("button", name="Close chat")
    if await close_chat.count() and await close_chat.first.is_visible():
        await close_chat.first.click()
    await p.get_by_role("button", name="Register", exact=True).click()
    await p.wait_for_url(re.compile(r"/setup|/register\?error"), timeout=45_000)
    if "error=true" in p.url:
        raise RuntimeError("Picktime refused the sign-up: \"We couldn't create your account\" "
                           "(happens without the proxy, or if the address was used before)")
    await p.locator("#setupCompanyName").wait_for()
    await ctx.step("account created")

    await p.locator("#setupCompanyName").fill(b["name"])
    await p.locator("#setupIndustry").select_option(label=INDUSTRIES.get(b["kind"], "Other"))
    await p.locator("#setupLocationName").fill("Main office")
    await p.locator("#setupLocationAddress").fill(street)
    await p.locator("#setupLocationCity").fill(city)
    await p.locator("#setupLocationState").fill(state)
    await p.locator("#setupLocationPin").fill(zipc)
    await p.locator("#setupBookingSlug").fill(slug)
    await p.wait_for_timeout(2_000)  # live availability check
    if await p.get_by_text("is already taken").first.is_visible():
        # booking link used by an earlier demo account: add a short suffix
        await p.locator("#setupBookingSlug").fill(f"{slug}{secrets.token_hex(2)}")
        await p.wait_for_timeout(2_000)
    await ctx.step(f"business details: {b['name']}, {b['kind']}, {street}")
    await p.get_by_role("button", name="Create business").click()
    await p.wait_for_url(re.compile(r"/app"), timeout=45_000)
    ctx.configured.append(f"business {b['name']} ({b['kind']}), {b['address']}")
    await p.get_by_role("link", name="Booking Types").wait_for(timeout=45_000)
    await ctx.step("business created, dashboard open")

    await dismiss_popups(p)
    await ctx.step("close the plan and news pop-ups (stay on Free)")

    await p.goto("https://www.picktime.com/app#services")
    row = p.get_by_text("Sample Service", exact=True).first
    await row.wait_for(timeout=30_000)
    await row.click()
    name = p.locator("input.servicename")
    await name.wait_for()
    await dismiss_popups(p)
    await name.fill(svc["name"])
    await p.locator("select.serviceduration").evaluate(
        "(s, v) => { s.value = v; s.dispatchEvent(new Event('input', {bubbles: true}));"
        " s.dispatchEvent(new Event('change', {bubbles: true})); }", str(svc["minutes"]))
    await name.press("Tab")
    save = p.locator("button.btn.btn-primary.save, button.unsaved-save").first
    if await save.is_visible():
        await save.click()
    await p.wait_for_timeout(2_500)  # let the save request finish (networkidle never settles: chat widget)
    await ctx.step(f"add service: {svc['name']}, {svc['minutes']} min")
    ctx.configured.append(f"service {svc['name']} ({svc['minutes']} min, ${svc.get('price', 0)})")

    await p.goto("https://www.picktime.com/app#services")
    await p.get_by_text(svc["name"]).first.wait_for()
    await ctx.step("service saved; opening hours stay at the default")
    ctx.configured.append("opening hours: default")

    href = await p.locator("a.sidenav-booking-link").first.get_attribute("href")
    url = f"https://www.picktime.com{href.replace('/fromApp', '')}"
    ctx.links["booking_page"] = url
    await ctx.step("booking page link found")

    await p.goto(url)
    await p.get_by_text(b["name"]).first.wait_for()
    await p.get_by_text(svc["name"]).first.wait_for()
    ctx.links["booking_page"] = p.url
    await ctx.step("public booking page")
