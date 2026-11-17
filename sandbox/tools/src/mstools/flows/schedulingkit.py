"""SchedulingKit: free account -> email link -> onboarding (service business) -> one service -> public booking page.

Recorded 2026-11-16 (traces/schedulingkit.md). The register page says "14-day free trial, no credit card".
"""
import re

NAME, DEFAULT_BIZ, TYPICAL_S = "SchedulingKit booking page", "landscaping", 60

INDUSTRY_BUTTONS = {"hair salon": "Salon", "HVAC repair": "Repair Services"}  # anything else: Other + free text


async def run(ctx):
    p, b = ctx.page, ctx.biz
    svc = b.get("service") or {"name": "Free estimate", "minutes": 30}

    await p.goto("https://app.schedulingkit.com/register")
    await p.locator("#email").wait_for()
    await ctx.step("open sign-up page")

    await p.locator("#name").fill(f"{b['first']} Team")
    await p.locator("#email").fill(ctx.email)
    await p.locator("#password").fill(ctx.password)
    await p.locator("#password_confirmation").fill(ctx.password)
    await ctx.step("fill sign-up form (email + password, no Google)")

    await p.get_by_role("button", name="Create your account").click()
    await p.wait_for_url(re.compile(r"/email/verify"), timeout=45_000)
    await ctx.step("account created, waiting for the verification email")

    mail = await ctx.mail.wait("schedulingkit", timeout=120)
    link = next(l for l in mail["links"] if "/email/verify/" in l)
    await p.goto(link)
    await p.wait_for_url(re.compile(r"/onboarding"), timeout=45_000)
    await ctx.step("email verified from AgentMail link")

    await p.locator("#business_name").fill(b["name"])
    await p.get_by_role("radio", name=re.compile(r"^Service business")).click()
    industry = INDUSTRY_BUTTONS.get(b["kind"])
    if industry:
        await p.get_by_role("button", name=industry, exact=True).click()
    else:
        await p.get_by_role("button", name="Other", exact=True).click()
        await p.get_by_role("textbox", name="Specify your industry").fill(b["kind"].title())
    await ctx.step("business details")
    await p.get_by_role("button", name="Continue", exact=True).click()

    await p.get_by_role("button", name="Skip for now").click()  # "Make it yours": logo and colour
    await ctx.step("skip logo and colour")

    await p.get_by_placeholder("e.g. Deep Tissue Massage").fill(svc["name"])
    dur = p.locator("select").first
    if str(svc["minutes"]) in await dur.locator("option").evaluate_all("os => os.map(o => o.value)"):
        await dur.select_option(str(svc["minutes"]))
    await p.get_by_role("button", name="Add", exact=True).click()
    await p.get_by_text(svc["name"], exact=True).first.wait_for()
    await ctx.step(f"add service: {svc['name']}, {svc['minutes']} min")
    ctx.configured.append(f"service {svc['name']} ({svc['minutes']} min)")
    await p.get_by_role("button", name="Continue", exact=True).click()

    await p.get_by_text(re.compile(r"When are you available")).first.wait_for()
    await ctx.step("keep default opening hours")
    await p.get_by_role("button", name="Continue", exact=True).click()

    preview = p.get_by_role("link", name="Preview your booking page")
    await preview.wait_for(timeout=45_000)
    url = await preview.get_attribute("href")
    ctx.links["booking_page"] = url
    await ctx.step("onboarding done: booking page is live")

    await p.goto(url)
    await p.get_by_text(b["name"]).first.wait_for()
    await ctx.step("public booking page")
