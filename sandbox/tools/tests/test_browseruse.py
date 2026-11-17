import json

import httpx
import pytest

from mstools import browseruse as bu


def _mock(monkeypatch, handler):
    monkeypatch.setenv("BROWSER_USE_API_KEY", "k-test")
    monkeypatch.setattr(bu, "_transport", httpx.MockTransport(handler))
    monkeypatch.setattr(bu.time, "sleep", lambda s: None)


def test_start_browser_solves_captchas_and_uses_the_proxy(monkeypatch):
    seen = {}

    def handler(req):
        seen["body"] = json.loads(req.content)
        seen["key"] = req.headers["X-Browser-Use-API-Key"]
        return httpx.Response(200, json={"id": "b1", "cdpUrl": "wss://cdp", "liveUrl": "https://live/x"})

    _mock(monkeypatch, handler)
    sess = bu.start_browser("us")
    assert sess["id"] == "b1" and seen["key"] == "k-test"
    assert seen["body"]["solveCaptchas"] is True and seen["body"]["proxyCountryCode"] == "us"
    assert seen["body"]["browserScreenWidth"] == 1440 and seen["body"]["browserScreenHeight"] == 900


def test_no_key_or_no_credit_is_unavailable(monkeypatch):
    monkeypatch.delenv("BROWSER_USE_API_KEY", raising=False)
    with pytest.raises(bu.Unavailable):
        bu.start_browser(None)
    _mock(monkeypatch, lambda req: httpx.Response(402, json={"detail": "insufficient credits"}))
    with pytest.raises(bu.Unavailable):
        bu.start_browser(None)


def test_stop_browser_never_raises(monkeypatch):
    _mock(monkeypatch, lambda req: httpx.Response(500))
    bu.stop_browser("b1")


def test_view_only_adds_the_read_only_params():
    assert bu.view_only("https://live/v?a=1") == "https://live/v?a=1&readOnly=true&ui=false"
    assert bu.view_only("https://live/v") == "https://live/v?readOnly=true&ui=false"


def test_run_agent_reports_the_live_view_once_and_returns_the_output(monkeypatch):
    calls = {"status": 0}

    def handler(req):
        p = req.url.path
        if req.method == "POST" and p.endswith("/runs"):
            body = json.loads(req.content)
            assert body["maxCostUsd"] == 0.40 and body["outputSchema"] == {"type": "object"}
            assert body["browserSettings"]["proxyCountryCode"] == "us"
            return httpx.Response(200, json={"id": "r1", "status": "queued", "sessionId": "s1"})
        if p.endswith("/events"):
            return httpx.Response(200, json={"events": [
                {"id": 1, "type": "browser.ready", "data": {"live_view_url": "https://live/r1"}}], "nextAfter": 1, "hasMore": False})
        if p.endswith("/status"):
            calls["status"] += 1
            return httpx.Response(200, json={"status": "running" if calls["status"] < 2 else "completed"})
        return httpx.Response(200, json={"id": "r1", "status": "completed", "output": {"ok": True}, "totalCostUsd": 0.12})

    _mock(monkeypatch, handler)
    lives = []
    out = bu.run_agent("sign up", {"type": "object"}, lives.append)
    assert out == {"status": "completed", "output": {"ok": True}, "cost": 0.12, "error": None, "session_id": "s1"}
    assert lives == ["https://live/r1?readOnly=true&ui=false"]
