"""Browser Use Cloud (API v4): standalone cloud browsers (recorded sign-ups, page renders) and AI agent runs.

Live view links are credentials (whoever has one can drive the browser), so nothing here prints or logs them:
they go to the caller's `on_live` callback, already made view-only.
"""
import asyncio
import contextlib
import os
import time
from typing import Callable

import httpx

from .cli import ToolError, log

API = "https://api.browser-use.com/api/v4"
TERMINAL = ("completed", "failed", "cancelled")
_transport: httpx.BaseTransport | None = None  # tests put an httpx.MockTransport here


class Unavailable(ToolError):
    """Browser Use can't be used right now (no key, no credit, no capacity, down): fall back to TinyFish."""


def _call(method: str, path: str, body: dict | None = None, params: dict | None = None) -> dict:
    key = os.environ.get("BROWSER_USE_API_KEY", "").strip()
    if not key:
        raise Unavailable("Browser Use is not set up here (no API key).")
    try:
        with httpx.Client(base_url=API, headers={"X-Browser-Use-API-Key": key}, timeout=30,
                          transport=_transport) as h:
            r = h.request(method, path, json=body, params=params)
    except httpx.HTTPError as e:
        raise Unavailable(f"Browser Use did not answer ({type(e).__name__}).")
    if r.status_code in (401, 402, 403, 429) or r.status_code >= 500:
        raise Unavailable(f"Browser Use refused the request ({r.status_code}).")
    if r.status_code >= 400:
        raise ToolError(f"Browser Use rejected the request ({r.status_code}): {r.text[:200]}")
    return r.json() if r.content else {}


def view_only(url: str) -> str:
    return f"{url}{'&' if '?' in url else '?'}readOnly=true&ui=false"


def start_browser(proxy: str | None, width: int = 1440, height: int = 900, minutes: int = 10) -> dict:
    """A cloud browser with CAPTCHA solving on. `proxy` None means no proxy (Browser Use's default is "us")."""
    return _call("POST", "/browsers", {
        "solveCaptchas": True, "proxyCountryCode": proxy, "browserScreenWidth": width,
        "browserScreenHeight": height, "timeout": minutes, "metadata": {"purpose": "mainstreet"}})


def stop_browser(browser_id: str) -> None:
    try:
        _call("PATCH", f"/browsers/{browser_id}", {"action": "stop"})
    except Exception as e:  # a browser we fail to stop times out by itself
        log(f"could not stop browser {browser_id}: {e}")


@contextlib.asynccontextmanager
async def browser(proxy: str | None = None, width: int = 1440, height: int = 900, minutes: int = 10,
                  on_live: Callable[[str], None] | None = None):
    """(page, session) in a fresh cloud browser over CDP; the browser is stopped on the way out, whatever happens."""
    from playwright.async_api import async_playwright

    sess = await asyncio.to_thread(start_browser, proxy, width, height, minutes)
    try:
        if on_live and sess.get("liveUrl"):
            on_live(view_only(sess["liveUrl"]))
        async with async_playwright() as p:
            b = await p.chromium.connect_over_cdp(sess["cdpUrl"])
            context = b.contexts[0] if b.contexts else await b.new_context()
            page = context.pages[0] if context.pages else await context.new_page()
            page.set_default_timeout(30_000)
            yield page, sess
    finally:
        await asyncio.to_thread(stop_browser, sess["id"])


def run_agent(task: str, schema: dict | None, on_live: Callable[[str], None], max_cost: float = 0.40,
              timeout_s: int = 600, proxy: str | None = "us", session_id: str | None = None,
              keep_alive: int | None = None) -> dict:
    """Browser Use's AI agent does `task`; returns {status, output, cost, error, session_id}. `on_live` gets the
    view-only live link once, as soon as the agent's browser is ready. `session_id` continues an earlier run's
    conversation (and its browser, while it is kept alive)."""
    body = {"task": task, "outputSchema": schema, "maxCostUsd": max_cost,
            "browserSettings": {"proxyCountryCode": proxy}}
    if session_id:
        body["sessionId"] = session_id
    if keep_alive:
        body["keepAlive"] = keep_alive
    if os.environ.get("MS_BU_MODEL"):
        body["model"] = os.environ["MS_BU_MODEL"]
    run = _call("POST", "/runs", body)
    rid, after, live_sent = run["id"], 0, False
    poll = float(os.environ.get("MS_POLL_SECONDS", "3"))
    deadline = time.time() + timeout_s
    status = run.get("status", "queued")
    while True:
        if not live_sent:
            ev = _call("GET", f"/runs/{rid}/events", params={"after": after, "limit": 50})
            for e in ev.get("events", []):
                after = max(after, int(e.get("id", 0)))
                url = (e.get("data") or {}).get("live_view_url") or (e.get("data") or {}).get("liveUrl")
                if url and not live_sent:
                    on_live(view_only(url))
                    live_sent = True
        status = _call("GET", f"/runs/{rid}/status").get("status", status)
        if status in TERMINAL:
            break
        if time.time() > deadline:
            with contextlib.suppress(Exception):
                _call("POST", f"/runs/{rid}/cancel")
            return {"status": "timeout", "output": None, "cost": None, "error": f"no result within {timeout_s}s",
                    "session_id": run.get("sessionId")}
        log(f"browser use run: {status}")
        time.sleep(poll)
    full = _call("GET", f"/runs/{rid}")
    return {"status": full.get("status", status), "output": full.get("output"), "cost": full.get("totalCostUsd"),
            "error": full.get("error"), "session_id": run.get("sessionId") or full.get("sessionId")}
