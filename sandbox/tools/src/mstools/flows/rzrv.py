"""RZRV: free account (no email verification seen) -> 3-step onboarding -> one service -> public booking page.

Recorded 2026-11-16 (traces/rzrv.md). RZRV has no business-type field, so nothing to set for the type.
"""
import re

NAME, DEFAULT_BIZ, TYPICAL_S = "RZRV booking page", "salon", 60


async def run(ctx):
    p, b = ctx.page, ctx.biz
    svc = b.get("service") or {"name": "Free estimate", "minutes": 30, "price": 0}

    await p.goto("https://rzrv.ai/register")
    await p.locator("#email").wait_for()
    await ctx.step("open sign-up page")

    await p.locator("#first_name").fill(b["first"])
    await p.locator("#last_name").fill("Team")
    await p.locator("#email").fill(ctx.email)
    await p.locator("#password").fill(ctx.password)
    await p.locator("#confirm_password").fill(ctx.password)
    await ctx.step("fill sign-up form (email + password, no Google)")

    await p.get_by_role("button", name="Create account", exact=True).click()
    await p.wait_for_url(re.compile(r"/onboarding"), timeout=45_000)
    await p.locator("#business-name").wait_for()
    await ctx.step("account created")

    await p.locator("#business-name").fill(b["name"])
    await ctx.step(f"business name: {b['name']}")
    await p.get_by_role("button", name="Continue", exact=True).click()

    await p.locator("#service-name").fill(svc["name"])
    await p.get_by_role("combobox").first.click()
    mins = svc["minutes"]
    label = {60: "1 hour", 90: "1.5 hours", 120: "2 hours"}.get(mins, f"{mins} minutes")
    await p.get_by_role("option", name=label, exact=True).click()
    price = svc.get("price", 0)
    cont = p.get_by_role("button", name="Continue", exact=True)
    await p.locator("#price").fill(f"{price:.2f}" if price else "")
    await p.locator("#price").press("Tab")
    added = await cont.is_enabled()
    if not added:  # RZRV greys out Continue for a $0 price: skip the service, the owner adds it with their price
        await p.get_by_role("button", name="Skip", exact=True).click()
        ctx.configured.append("no service yet: RZRV needs a price, add it in RZRV")
        await ctx.step("skip the first service (no price known)")
    else:
        await ctx.step(f"add service: {svc['name']}, {mins} min, ${price}")
        await cont.click()
        ctx.configured.append(f"service {svc['name']} ({mins} min, ${price})")

    await p.get_by_role("button", name="Complete Setup").wait_for()
    await ctx.step("keep default opening hours (Mon-Fri 9-5)")
    await p.get_by_role("button", name="Complete Setup").click()

    await p.get_by_role("button", name="Go to Dashboard").click()
    link = p.get_by_role("link", name="View Booking Page").first
    await link.wait_for(timeout=45_000)
    url = await link.get_attribute("href")
    if url.startswith("/"):
        url = "https://rzrv.ai" + url
    ctx.links["booking_page"] = url
    await ctx.step("setup done: booking page is live")

    await p.goto(url)
    await p.get_by_text(b["name"]).first.wait_for()
    if added:
        await p.get_by_text(svc["name"]).first.wait_for()
    await ctx.step("public booking page")
