"""Chatling: free account -> email verify -> onboarding -> AI agent trained on the business site -> public share link.

Recorded 2026-11-16 (traces/chatling.md). Sign-up has a Cloudflare Turnstile that passes by itself; the runner's
guard() allows it. The website crawl can return unrelated pages, so the flow clears them and keeps only the site URL.
"""
import asyncio
import re

from mstools.bu import Stop

NAME, DEFAULT_BIZ, TYPICAL_S = "Chatling chatbot", "coffee", 120
NEEDS_SITE = True  # trains the bot on the shop's site
PROXY = "us"  # without the residential proxy the Cloudflare Turnstile never passes by itself (2026-11-17)


async def _wait_turnstile(p):
    """Wait (<= 45 s) for the Turnstile token while Browser Use solves it. Never click it."""
    for _ in range(45):
        tok = await p.evaluate("() => [...document.querySelectorAll('input[name=\"cf-turnstile-response\"]')]"
                               ".map(i => i.value).join('')")
        if tok or not any("challenges.cloudflare.com" in f.url for f in p.frames):
            return
        await asyncio.sleep(1)
    raise Stop("captcha", "Cloudflare Turnstile was not solved within 45 s")


async def run(ctx):
    p, b = ctx.page, ctx.biz
    site = b["site"].rstrip("/")

    await p.goto("https://app.chatling.ai/register")
    await p.locator("#register_email").wait_for()
    await ctx.step("open Chatling sign-up page")

    await p.locator("#register_fname").fill(b["first"])
    await p.locator("#register_lname").fill("Team")
    await p.locator("#register_email").fill(ctx.email)
    await p.locator("#register_password").fill(ctx.password)
    await _wait_turnstile(p)
    await ctx.step("fill sign-up form (email + password, no Google)")

    await p.get_by_role("button", name="Create account").click()
    await p.wait_for_url(re.compile(r"/login|/projects/"), timeout=45_000)
    await ctx.step("account created, waiting for the verification email")

    mail = await ctx.mail.wait("chatling", timeout=120)
    link = next(l for l in mail["links"] if "/account/verify" in l)
    await p.goto(link)
    await p.wait_for_load_state("domcontentloaded")
    await ctx.step("email verified from AgentMail link")

    for attempt in range(3):
        if re.search(r"/projects/\d+/chatbots", p.url):
            break
        if "/login" not in p.url:
            await p.goto("https://app.chatling.ai/login")
        await p.locator("#login_email").wait_for(timeout=30_000)
        await p.locator("#login_email").fill(ctx.email)
        await p.locator("#login_password").fill(ctx.password)
        await _wait_turnstile(p)
        await p.get_by_role("button", name="Sign in").click()
        try:
            await p.wait_for_url(re.compile(r"/projects/\d+/chatbots"), timeout=20_000)
        except Exception:
            await p.reload()  # "Verification failed. Please refresh" -> fresh Turnstile, try again
    await p.get_by_role("heading", name="Welcome to Chatling").wait_for(timeout=30_000)
    await ctx.step("signed in to the Chatling dashboard")

    # About you: three dropdowns, plain generic answers.
    for label, value in [("What kind of work do you do?", "other"), ("What is your role?", "founder"),
                         ("How did you discover Chatling?", "other")]:
        await p.locator(".onb-field").filter(has_text=label).locator("select").select_option(value)
    await ctx.step("answer the welcome questions")
    await p.get_by_role("button", name="Continue", exact=True).click()

    await p.get_by_role("heading", name="What do you want to build?").wait_for(timeout=30_000)
    await p.get_by_role("button", name=re.compile(r"^Recommended AI Agent")).click()
    await ctx.step("choose AI Agent / Chatbot (free plan)")

    await p.get_by_role("heading", name="Let's set up your AI agent").wait_for(timeout=30_000)
    await p.locator("input.onb-url__input").fill(site.replace("https://", ""))
    await ctx.step("point the agent at the coffee shop's website")
    await p.get_by_role("button", name="Continue", exact=True).click()

    await p.get_by_role("heading", name="Does this look right?").wait_for(timeout=90_000)
    await ctx.step("Chatling drafted the business profile")
    await p.get_by_role("button", name="Continue", exact=True).click()

    await p.get_by_role("heading", name="Train your Agent on your content").wait_for(timeout=60_000)
    box = p.get_by_role("textbox", name="example.com")
    if await box.count():
        await box.fill(site.replace("https://", ""))
        await p.get_by_role("button", name="Next", exact=True).click()
    await ctx.step("start crawling the website")

    # Wait for the crawl table, then keep only the business's own URL.
    await p.get_by_role("button", name="Bulk edit").wait_for(timeout=90_000)
    await asyncio.sleep(2)
    rows = p.locator("tbody tr")
    own = p.locator(f"tbody a[href^='{site}']")
    if await rows.count() != 1 or await own.count() != 1:
        await p.get_by_role("button", name="Bulk edit").click()
        await p.locator("table thead input[type=checkbox]").check()
        await p.locator("[data-bulk-action='delete']").click()
        await p.get_by_role("button", name="Add URL").click()
        await p.get_by_placeholder("https://example.com").fill(site + "/")
        await p.get_by_role("button", name="Submit").last.click()
        await p.locator(f"tbody a[href^='{site}']").first.wait_for(timeout=60_000)
        await ctx.step("remove unrelated crawl results, keep only the coffee shop's site")
    await p.get_by_text("Total pages: 1").wait_for(timeout=15_000)
    await ctx.step("train the bot on the coffee shop's website")
    await p.get_by_role("button", name="Submit", exact=True).click()
    ctx.configured.append(f"knowledge source {site}")

    await p.get_by_role("heading", name="Fine-tune your Agent").wait_for(timeout=60_000)
    await ctx.step("keep default agent instructions")
    await p.get_by_role("button", name="Continue", exact=True).click()

    await p.get_by_role("heading", name="Design your chat widget").wait_for(timeout=30_000)
    await p.get_by_placeholder("Support Agent").fill(b["name"])
    await p.get_by_placeholder("AI Assistant").fill("Bean & Brick Barista")
    await ctx.step("name the chat widget")
    await p.get_by_role("button", name="Finish").click()
    await p.wait_for_url(re.compile(r"/chatbots/\d+"), timeout=60_000)
    ctx.configured.append(f"chatbot {b['name']}")
    await ctx.step("chatbot created on the Free plan")

    deploy = re.sub(r"/chatbots/(\d+).*", r"/chatbots/\1/deploy/share", p.url)
    await p.goto(deploy)
    await p.get_by_role("button", name="Create link").click()
    url_el = p.get_by_text(re.compile(r"https://share\.chatling\.ai/s/\w+")).first
    await url_el.wait_for(timeout=30_000)
    url = re.search(r"https://share\.chatling\.ai/s/\w+", await url_el.inner_text()).group(0)
    ctx.links["chat_page"] = url
    await ctx.step("create the public share link")

    await p.goto(url)
    await p.get_by_placeholder("Type here...").wait_for(timeout=45_000)
    await ctx.step("public chat page")
