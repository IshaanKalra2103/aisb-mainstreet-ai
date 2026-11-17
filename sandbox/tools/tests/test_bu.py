"""bu setup: recorded sign-up in a Browser Use browser, agent fallback, view-only stream, no login details in output."""
import asyncio
import contextlib
import json
import sys
import types

import pytest

from mstools import bu, browseruse, budget, config, ws

LIVE = "https://live.browser-use.com/x?readOnly=true&ui=false"


def _profile():
    ws.save("profile", {"name": "Vigilante Coffee", "business_type": "coffee_shop", "city": "Hyattsville",
                        "state": "MD", "size": "small", "website": "https://vigilantecoffee.com", "summary": "Roaster."})


def _approve(env, aid="ap_1", tools=("rzrv",)):
    (env["decisions"] / f"{aid}.json").write_text(json.dumps(
        {"id": aid, "summary": "s", "status": "approved", "tool_id": tools[0], "tool_ids": list(tools)}))


def _fake_browser(monkeypatch, fail=None):
    @contextlib.asynccontextmanager
    async def fake(proxy=None, width=1440, height=900, minutes=10, on_live=None):
        if fail:
            raise fail
        on_live(LIVE)
        yield types.SimpleNamespace(url="https://site/x", frames=[]), {"id": "b1"}
    monkeypatch.setattr(browseruse, "browser", fake)


def _flow(monkeypatch, run, name="RZRV booking page"):
    mod = types.SimpleNamespace(NAME=name, run=run)
    monkeypatch.setattr(bu, "load_flow", lambda tool: mod)

    async def no_guard(page):
        return None
    monkeypatch.setattr(bu, "guard", no_guard)


def _setup(monkeypatch, capsys, tool="rzrv", aid="ap_1"):
    monkeypatch.setattr(sys, "argv", ["bu", "setup", "--tool", tool, "--approval", aid,
                                      "--inbox", "shop+x@agentmail.to", "--password", "Pw-secret-123"])
    with pytest.raises(SystemExit):
        bu.main()
    out = capsys.readouterr()
    return json.loads(out.out.strip().splitlines()[-1]), out


def test_flow_done_streams_view_only_and_never_prints_login(env, monkeypatch, capsys):
    _profile(); _approve(env); _fake_browser(monkeypatch)
    seen = {}

    async def run(ctx):
        seen["rec"] = ws.load("setup", "rzrv")
        await ctx.step("account created")
        ctx.links["booking_page"] = "https://rzrv.ai/b/vigilante"
        ctx.configured.append("service Coffee tasting (30 min, $0)")
    _flow(monkeypatch, run)
    res, out = _setup(monkeypatch, capsys)
    assert seen["rec"]["status"] == "running" and seen["rec"]["streaming_url"] == LIVE
    assert res["outcome"] == "done" and res["path"] == "flow"
    assert res["links"] == {"booking_page": "https://rzrv.ai/b/vigilante"}
    for secret in ("live.browser-use.com", "Pw-secret-123", "shop+x@agentmail.to"):
        assert secret not in out.out and secret not in out.err
    rec = ws.load("setup", "rzrv")
    assert rec["status"] == "done" and rec["links"]["booking_page"].startswith("https://rzrv.ai")
    assert rec["streaming_url"] is None and rec["password"] == "Pw-secret-123"
    assert budget.spent(config.owner_budget(), "browser_owner") == pytest.approx(0.02)
    runs = [json.loads(p.read_text()) for p in (env["work"] / "runs").glob("*.json")]
    assert runs and runs[0]["provider"] == "bu" and runs[0]["tool_id"] == "rzrv"


def test_card_form_hands_to_owner(env, monkeypatch, capsys):
    _profile(); _approve(env); _fake_browser(monkeypatch)

    async def run(ctx):
        raise bu.Stop("card", "a card / payment form is on the page")
    _flow(monkeypatch, run)
    res, _ = _setup(monkeypatch, capsys)
    assert res["outcome"] == "needs_owner" and "card" in res["reason"]
    assert ws.load("setup", "rzrv")["status"] == "needs_owner"


def test_break_before_account_runs_the_agent(env, monkeypatch, capsys):
    _profile(); _approve(env); _fake_browser(monkeypatch)

    async def run(ctx):
        await ctx.step("open sign-up page")
        raise RuntimeError("selector #email not found")
    _flow(monkeypatch, run)
    calls = []

    def fake_agent(task, schema, on_live, max_cost=0.40, timeout_s=600, proxy="us", session_id=None, keep_alive=None):
        calls.append(task)
        on_live(LIVE)
        return {"status": "completed", "session_id": "s1", "cost": 0.2, "error": None,
                "output": {"account_created": True, "waiting_for_email": False, "stopped_for": None,
                           "links": {"booking_page": "https://rzrv.ai/b/v"}, "configured": ["service"]}}
    monkeypatch.setattr(browseruse, "run_agent", fake_agent)
    res, out = _setup(monkeypatch, capsys)
    assert len(calls) == 1 and "Vigilante Coffee" in calls[0]
    assert res["outcome"] == "done" and res["path"] == "agent" and res["links"]["booking_page"] == "https://rzrv.ai/b/v"
    assert "live.browser-use.com" not in out.out
    assert budget.spent(config.owner_budget(), "browser_owner") == pytest.approx(0.42)


def test_break_after_account_hands_to_owner_without_agent(env, monkeypatch, capsys):
    _profile(); _approve(env); _fake_browser(monkeypatch)

    async def run(ctx):
        await ctx.step("account created")
        raise RuntimeError("timeout on the services page")
    _flow(monkeypatch, run)
    monkeypatch.setattr(browseruse, "run_agent", lambda *a, **k: pytest.fail("agent must not run"))
    res, _ = _setup(monkeypatch, capsys)
    assert res["outcome"] == "needs_owner" and res["path"] == "flow"


def test_browser_use_unavailable_falls_back_to_tinyfish(env, monkeypatch, capsys):
    _profile(); _approve(env); _fake_browser(monkeypatch, fail=browseruse.Unavailable("no key"))
    _flow(monkeypatch, None)
    res, _ = _setup(monkeypatch, capsys)
    assert res["fallback"] == "tf" and res["outcome"] == "failed"


def test_needs_an_approval_for_that_tool(env, monkeypatch, capsys):
    _profile(); _approve(env, tools=("picktime",)); _fake_browser(monkeypatch)
    _flow(monkeypatch, None)
    monkeypatch.setattr(sys, "argv", ["bu", "setup", "--tool", "rzrv", "--approval", "ap_1"])
    with pytest.raises(SystemExit):
        bu.main()
    assert "not rzrv" in json.loads(capsys.readouterr().out.strip().splitlines()[-1])["error"]


def test_biz_from_profile_fills_every_key():
    b = bu.biz_from_profile({"name": "Fade Lab", "business_type": "salon", "city": "Towson", "state": "MD"})
    assert set(b) >= {"name", "first", "city", "phone", "kind", "site", "address", "service"}
    assert b["first"] == "Fade" and b["kind"] == "hair salon" and b["address"].endswith("Towson, MD")
    assert b["service"]["name"] and b["service"]["minutes"] in (30, 60)
    assert bu.biz_from_profile({})["name"]
    assert bu.parse_service("Haircut|45|35") == {"name": "Haircut", "minutes": 45, "price": 35.0}
    assert bu.parse_service("Haircut") is None and bu.parse_service("x|y|z") is None
    assert bu.biz_from_profile({}, service=bu.parse_service("Latte class|60|20"))["service"]["minutes"] == 60


class _Widget:
    def __init__(self, visible):
        self.visible = visible

    async def count(self):
        return 1

    def nth(self, i):
        return self

    async def is_visible(self):
        return self.visible()


class _Page:
    def __init__(self, visible):
        self.frames, self.w = [], _Widget(visible)

    def locator(self, sel):
        return self.w if "captcha" in sel else types.SimpleNamespace(count=_zero)


async def _zero():
    return 0


def test_guard_waits_for_the_solver_then_stops(monkeypatch):
    monkeypatch.setattr(bu, "CAPTCHA_WAIT_S", 0.3)
    monkeypatch.setattr(bu, "POLL_S", 0.05)
    polls = {"n": 0}

    def gone_after_two():
        polls["n"] += 1
        return polls["n"] <= 2
    asyncio.run(bu.guard(_Page(gone_after_two)))  # the solver cleared it: no stop
    with pytest.raises(bu.Stop) as e:
        asyncio.run(bu.guard(_Page(lambda: True)))
    assert e.value.stopped_at == "captcha"
