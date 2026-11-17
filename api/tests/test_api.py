import time
import asyncio
import json
import os

import pytest

from conftest import script, sse_events
from msapi.runner import DockerRunner, FakeRunner
from msapi.workspaces import Workspaces


async def new_owner(client, source="https://coffee.example"):
    r = await client.post("/api/owners", json={"source": source})
    assert r.status_code == 200
    return r.json()["owner_id"]


async def test_create_owner_writes_source(make_client, settings):
    app, c = make_client()
    oid = await new_owner(c)
    assert oid.startswith("o_")
    assert json.loads((settings.workspaces / oid / "source.json").read_text())["source"] == "https://coffee.example"


async def test_turn_streams_fake_events_to_done(make_client, settings):
    app, c = make_client()
    oid = await new_owner(c)
    tid = (await c.post(f"/api/owners/{oid}/turns", json={"text": "hi"})).json()["turn_id"]
    events = await sse_events(c, tid)
    types = [e["type"] for e in events]
    assert types[-1] == "done" and events[-1]["reply"] == "Here is what I found."
    assert {"type": "files", "kinds": ["profile"]} in events
    assert not any(e["type"] == "status" and "Reading your website now" in e["text"] for e in events)
    bundle = (await c.get(f"/api/owners/{oid}")).json()
    assert [m["role"] for m in bundle["messages"]] == ["owner", "agent"]
    assert (settings.workspaces / oid / "turns" / f"{tid}.jsonl").exists()


async def test_session_id_first_then_resume(make_client):
    runner = FakeRunner(script())
    app, c = make_client(runner)
    oid = await new_owner(c)
    for _ in range(2):
        tid = (await c.post(f"/api/owners/{oid}/turns", json={"text": "hi"})).json()["turn_id"]
        await sse_events(c, tid)
    assert [call["resume"] for call in runner.calls] == [False, True]
    assert runner.calls[0]["session_id"] == runner.calls[1]["session_id"]


async def test_turn_beyond_concurrency_is_queued(make_client):
    runner = FakeRunner(script(), delay=0.05)
    app, c = make_client(runner)
    owners = [await new_owner(c) for _ in range(3)]
    tids = [(await c.post(f"/api/owners/{o}/turns", json={"text": "go"})).json()["turn_id"] for o in owners]
    results = await asyncio.gather(*(sse_events(c, t) for t in tids))
    assert results[2][0] == {"type": "queued", "position": 1}
    assert all(r[-1]["type"] == "done" for r in results)


async def test_max_two_concurrent(make_client):
    runner = FakeRunner(script(), delay=0.05)
    app, c = make_client(runner)
    owners = [await new_owner(c) for _ in range(4)]
    tids = [(await c.post(f"/api/owners/{o}/turns", json={"text": "go"})).json()["turn_id"] for o in owners]
    results = await asyncio.gather(*(sse_events(c, t) for t in tids))
    assert all(r[-1]["type"] == "done" for r in results)
    assert runner.max_active == 2


async def test_approval_decide_twice_409_and_one_turn(make_client, settings):
    runner = FakeRunner(script())
    app, c = make_client(runner)
    oid = await new_owner(c)
    ws = Workspaces(settings.workspaces)
    (ws.owner_dir(oid) / "approvals").mkdir()
    (ws.owner_dir(oid) / "approvals" / "ap_1.json").write_text(json.dumps(
        {"id": "ap_1", "tool_id": "chat-a", "summary": "Create a free account", "status": "pending", "created_at": "2026-11-08T00:00:00Z"}))
    r1, r2 = await asyncio.gather(
        c.post(f"/api/owners/{oid}/approvals/ap_1", json={"decision": "approve"}),
        c.post(f"/api/owners/{oid}/approvals/ap_1", json={"decision": "approve"}))
    codes = sorted([r1.status_code, r2.status_code])
    assert codes == [200, 409]
    ok = r1 if r1.status_code == 200 else r2
    await sse_events(c, ok.json()["turn_id"])
    assert len(runner.calls) == 1 and "Owner approved approval ap_1" in runner.calls[0]["prompt"]
    assert json.loads((ws.owner_dir(oid) / "approvals" / "ap_1.json").read_text())["status"] == "approved"
    decision = json.loads((ws.decisions_dir(oid) / "ap_1.json").read_text())
    assert decision["status"] == "approved" and decision["tool_id"] == "chat-a"


async def test_bundle_hides_password_and_reveal_once(make_client, settings):
    app, c = make_client()
    oid = await new_owner(c)
    p = Workspaces(settings.workspaces).owner_dir(oid) / "setup_chat-a.json"
    p.write_text(json.dumps({"tool_id": "chat-a", "status": "done", "username": "u", "password": "s3cret-pw", "configured": [], "next_steps": []}))
    r = await c.get(f"/api/owners/{oid}")
    assert "s3cret-pw" not in r.text
    assert r.json()["setups"]["chat-a"]["has_password"] is True
    first = await c.get(f"/api/owners/{oid}/password/chat-a")
    assert first.status_code == 200 and first.json()["password"] == "s3cret-pw"
    second = await c.get(f"/api/owners/{oid}/password/chat-a")
    assert second.status_code == 410


async def test_bad_owner_id_is_404(make_client):
    app, c = make_client()
    assert (await c.get("/api/owners/..%2F..%2Fetc")).status_code == 404
    assert (await c.get("/api/owners/o_0000000000")).status_code == 404


HASH = "a" * 64


async def test_imessage_rate_limit_429(make_client):
    app, c = make_client()
    r1 = await c.post("/api/imessage", json={"from_hash": HASH, "text": "hi"})
    r2 = await c.post("/api/imessage", json={"from_hash": HASH, "text": "again"})
    assert r1.status_code == 200 and r2.status_code == 429
    assert "few seconds" in r2.json()["detail"]


async def test_imessage_replies_capped_at_3(make_client):
    reply = "One.\n\nTwo.\n\nThree.\n\nFour.\n\nFive."
    app, c = make_client(FakeRunner(script(reply=reply)))
    r = await c.post("/api/imessage", json={"from_hash": HASH, "text": "I run a salon"})
    body = r.json()
    assert len(body["replies"]) <= 3 and body["link"].startswith("https://web.example/b/o_")
    r_again = await c.post("/api/imessage", json={"from_hash": "b" * 64, "text": "hi"})
    assert r_again.json()["link"] != body["link"]


async def test_imessage_same_sender_same_owner(make_client, settings):
    app, c = make_client()
    app.state.imessage.min_gap = 0
    a = (await c.post("/api/imessage", json={"from_hash": HASH, "text": "hi"})).json()["link"]
    b = (await c.post("/api/imessage", json={"from_hash": HASH, "text": "more"})).json()["link"]
    assert a == b


async def test_health_reports_docker_and_token(make_client):
    app, c = make_client(check_docker=lambda: True, check_token=lambda: False)
    r = (await c.get("/api/health")).json()
    assert r == {"ok": False, "docker": True, "token": False}
    app2, c2 = make_client(check_docker=lambda: True, check_token=lambda: True)
    assert (await c2.get("/api/health")).json()["ok"] is True


def test_docker_runner_command(settings, monkeypatch):
    monkeypatch.setenv("CLAUDE_CODE_OAUTH_TOKEN", " junk sk-ant-oat01-abc\ndef ")
    r = DockerRunner(settings)
    cmd = r.command("o_1234567890", "hello", "sid-1", resume=False)
    assert cmd[:3] == ["docker", "run", "--rm"]
    assert f"{settings.workspaces / 'o_1234567890'}:/work" in cmd
    assert cmd[cmd.index("--session-id") + 1] == "sid-1" and "--resume" not in cmd
    assert f"{settings.workspaces / '_decisions' / 'o_1234567890'}:/decisions:ro" in cmd
    assert "claude-sonnet-5-5" in cmd and "stream-json" in cmd
    assert r.command("o_1234567890", "hello", "sid-1", resume=True)[r.command("o_1234567890", "hello", "sid-1", resume=True).index("--resume") + 1] == "sid-1"
    assert r.env()["CLAUDE_CODE_OAUTH_TOKEN"] == "sk-ant-oat01-abcdef"


async def test_imessage_requires_relay_secret_when_set(make_client, settings):
    settings.relay_secret = "relay-s3cret"
    app, c = make_client()
    body = {"from_hash": HASH, "text": "hi"}
    assert (await c.post("/api/imessage", json=body)).status_code == 401
    assert (await c.post("/api/imessage", json=body, headers={"x-relay-secret": "nope"})).status_code == 401
    assert (await c.post("/api/imessage", json=body, headers={"x-relay-secret": "relay-s3cret"})).status_code == 200


async def test_owner_daily_cap_429(make_client, settings):
    settings.owners_per_day = 2
    app, c = make_client()
    await new_owner(c)
    await new_owner(c)
    r = await c.post("/api/owners", json={"source": "x"})
    assert r.status_code == 429


async def test_turn_events_replay_after_restart(make_client, settings):
    app, c = make_client()
    oid = await new_owner(c)
    tid = (await c.post(f"/api/owners/{oid}/turns", json={"text": "hi"})).json()["turn_id"]
    await sse_events(c, tid)
    app2, c2 = make_client()
    events = await sse_events(c2, tid)
    assert events[-1] == {"type": "done", "reply": "Here is what I found."}
    assert (await c2.get("/api/turns/t_000000000000/events")).status_code == 404


async def test_media_serves_only_preview_mp4(make_client, settings):
    app, c = make_client()
    oid = await new_owner(c)
    d = settings.workspaces / oid
    (d / "preview_chat-a.mp4").write_bytes(b"\x00\x00\x00\x18ftypmp42")
    assert (await c.get(f"/media/{oid}/preview_chat-a.mp4")).status_code == 200
    assert (await c.get(f"/media/{oid}/source.json")).status_code == 404
    assert (await c.get(f"/media/{oid}/setup_chat-a.json")).status_code == 404


class GateRunner(FakeRunner):
    """Holds every turn open until `gate` is set, so tests can see queued and running turns."""

    def __init__(self, events=None):
        super().__init__(events or script())
        self.gate = asyncio.Event()

    async def run(self, owner_id, prompt, session_id, resume):
        await self.gate.wait()
        async for ev in super().run(owner_id, prompt, session_id, resume):
            yield ev


BUSY_OWNER = "I'm still working on your last message. Give me a minute."
BUSY_ALL = "We're busy right now. Try again in a few minutes."


def write_approval(settings, oid, ap_id="ap_1"):
    d = Workspaces(settings.workspaces).owner_dir(oid) / "approvals"
    d.mkdir(exist_ok=True)
    (d / f"{ap_id}.json").write_text(json.dumps(
        {"id": ap_id, "tool_id": "chat-a", "summary": "Create a free account", "status": "pending", "created_at": "2026-11-08T00:00:00Z"}))


async def test_owner_cap_per_client_ip(make_client, settings):
    assert settings.owners_per_ip_day == 6 and settings.owners_per_day == 120
    app, c = make_client()
    judge = {"CF-Connecting-IP": "203.0.113.7"}
    for _ in range(6):
        assert (await c.post("/api/owners", json={"source": "x"}, headers=judge)).status_code == 200
    r = await c.post("/api/owners", json={"source": "x"}, headers=judge)
    assert r.status_code == 429 and r.json()["detail"]
    other = await c.post("/api/owners", json={"source": "x"}, headers={"CF-Connecting-IP": "198.51.100.2"})
    assert other.status_code == 200
    # No header: keyed on the socket peer, which has its own six.
    for _ in range(6):
        assert (await c.post("/api/owners", json={"source": "x"})).status_code == 200
    assert (await c.post("/api/owners", json={"source": "x"})).status_code == 429


async def test_one_unfinished_turn_per_owner(make_client):
    runner = GateRunner()
    app, c = make_client(runner)
    oid = await new_owner(c)
    t1 = (await c.post(f"/api/owners/{oid}/turns", json={"text": "one"})).json()["turn_id"]
    r2 = await c.post(f"/api/owners/{oid}/turns", json={"text": "two"})
    assert r2.status_code == 429 and r2.json()["detail"] == BUSY_OWNER
    runner.gate.set()
    assert (await sse_events(c, t1))[-1]["type"] == "done"
    assert (await c.post(f"/api/owners/{oid}/turns", json={"text": "three"})).status_code == 200
    msgs = (await c.get(f"/api/owners/{oid}")).json()["messages"]
    assert [m["text"] for m in msgs if m["role"] == "owner"] == ["one", "three"]


async def test_global_waiting_cap(make_client, settings):
    runner = GateRunner()
    app, c = make_client(runner)
    owners = [app.state.ws.create_owner("x") for _ in range(9)]
    for o in owners[:8]:  # 2 running + 6 waiting
        assert (await c.post(f"/api/owners/{o}/turns", json={"text": "go"})).status_code == 200
    r = await c.post(f"/api/owners/{owners[8]}/turns", json={"text": "go"})
    assert r.status_code == 429 and r.json()["detail"] == BUSY_ALL
    runner.gate.set()


async def test_approval_busy_leaves_it_pending(make_client, settings):
    runner = GateRunner()
    app, c = make_client(runner)
    oid = await new_owner(c)
    write_approval(settings, oid)
    t1 = (await c.post(f"/api/owners/{oid}/turns", json={"text": "one"})).json()["turn_id"]
    r = await c.post(f"/api/owners/{oid}/approvals/ap_1", json={"decision": "approve"})
    assert r.status_code == 429 and r.json()["detail"] == BUSY_OWNER
    ws = Workspaces(settings.workspaces)
    assert json.loads((ws.owner_dir(oid) / "approvals" / "ap_1.json").read_text())["status"] == "pending"
    assert not (ws.decisions_dir(oid) / "ap_1.json").exists()
    runner.gate.set()
    await sse_events(c, t1)
    ok = await c.post(f"/api/owners/{oid}/approvals/ap_1", json={"decision": "approve"})
    assert ok.status_code == 200 and ok.json()["turn_id"]


async def test_imessage_busy_owner_gets_text(make_client):
    runner = GateRunner()
    app, c = make_client(runner)
    app.state.imessage.wait_s = 0.5
    oid = app.state.ws.owner_for_phone(HASH)
    app.state.turns.start(oid, "first", "imessage")
    r = await c.post("/api/imessage", json={"from_hash": HASH, "text": "hello?"})
    assert r.status_code == 429 and r.json()["detail"] == BUSY_OWNER
    runner.gate.set()


async def test_health_serves_cache_while_refreshing(make_client, settings):
    import threading
    release, calls = threading.Event(), []

    def docker():
        calls.append(1)
        if len(calls) > 1:
            release.wait(5)
            return False
        return True

    settings.health_ttl = 0.0
    app, c = make_client(check_docker=docker, check_token=lambda: True)
    assert (await c.get("/api/health")).json()["ok"] is True
    # Stale: the refresh runs in a thread, and callers get the cached body meanwhile.
    for _ in range(3):
        r = await asyncio.wait_for(c.get("/api/health"), 1.0)
        assert r.json()["ok"] is True
    for _ in range(50):
        if len(calls) >= 2:
            break
        await asyncio.sleep(0.02)
    assert len(calls) == 2  # one refresh in flight, not one per caller
    release.set()
    for _ in range(50):
        await asyncio.sleep(0.02)
        if (await c.get("/api/health")).json()["docker"] is False:
            break
    else:
        raise AssertionError("refresh never landed")


async def test_health_first_call_on_fresh_boot(make_client, settings, monkeypatch):
    # Right after a VM boots, time.monotonic() is about the uptime, so it can be below health_ttl.
    # The first call must still check health instead of failing with KeyError 'task'.
    import msapi.app as app_mod
    monkeypatch.setattr(app_mod.time, "monotonic", lambda: 5.0)
    settings.health_ttl = 20.0
    app, c = make_client(check_docker=lambda: True, check_token=lambda: True)
    r = await c.get("/api/health")
    assert r.status_code == 200 and r.json()["ok"] is True


async def test_poll_pages_public_events(make_client):
    runner = GateRunner([{"type": "system", "subtype": "init"}, {"type": "runner_error", "message": "secret stack"}])
    app, c = make_client(runner)
    oid = await new_owner(c)
    tid = (await c.post(f"/api/owners/{oid}/turns", json={"text": "hi"})).json()["turn_id"]
    r = await c.get(f"/api/turns/{tid}/poll")
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    assert r.json()["done"] is False
    runner.gate.set()
    await sse_events(c, tid)
    full = (await c.get(f"/api/turns/{tid}/poll?after=0")).json()
    assert full["done"] is True and full["next"] == len(full["events"])
    assert full["events"][-1]["type"] == "error" and "secret stack" not in json.dumps(full)
    tail = (await c.get(f"/api/turns/{tid}/poll?after=1")).json()
    assert tail["events"] == full["events"][1:] and tail["next"] == full["next"]
    assert (await c.get(f"/api/turns/{tid}/poll?after={full['next']}")).json()["events"] == []
    assert (await c.get("/api/turns/t_000000000000/poll")).status_code == 404


def test_split_texts_plain_bubbles_and_urls_out():
    from msapi.imessage import split_texts
    link = "https://web.example/b/o_1"
    reply = ("**Good news:** a chatbot fits your salon.\n\n"
             "## Local help\n- Maryland SBDC: https://www.marylandsbdc.org\n- [Library](https://lib.example/x) is free.\n\n"
             f"Two.\n\nThree.\n\nFour. {link}")
    texts, urls = split_texts(reply, link)
    assert len(texts) == 3
    joined = "\n".join(texts)
    for bad in ("**", "##", "- ", "](", "http"):
        assert bad not in joined
    assert "Maryland SBDC" in joined and "Library is free." in joined
    assert len(urls) == 1 and urls[0].startswith("https://")  # one extra card at most; the page link is not repeated


def test_split_texts_empty_falls_back():
    from msapi.imessage import split_texts
    assert split_texts("", "L")[0] == ["Done. Everything is on your page."]


async def test_imessage_returns_links_and_new_preview_video(make_client, settings):
    app, c = make_client(FakeRunner(script(reply="Done.")))
    oid = app.state.ws.owner_for_phone(HASH)
    (app.state.ws.owner_dir(oid) / "preview_x.mp4").write_bytes(b"v")
    import os
    os.utime(app.state.ws.owner_dir(oid) / "preview_x.mp4", (1, 1))  # older than the turn: not this turn's video
    body = (await c.post("/api/imessage", json={"from_hash": HASH, "text": "hi"})).json()
    assert body["links"] == [f"{body['link']}/shop"] and body["video_url"] is None
    app.state.imessage.min_gap = 0
    future = time.time() + 5
    os.utime(app.state.ws.owner_dir(oid) / "preview_x.mp4", (future, future))
    body = (await c.post("/api/imessage", json={"from_hash": HASH, "text": "again"})).json()
    assert body["video_url"] == f"/media/{oid}/preview_x.mp4"


def test_split_texts_keeps_share_url_whole():
    from msapi.imessage import split_texts
    parts, urls = split_texts("Tap to share your shop: https://w/b/o1/shop", "https://w/b/o1")
    assert urls == ["https://w/b/o1/shop"] and not any("/shop" in p for p in parts)


async def test_imessage_sends_share_card_until_profile_has_facts(make_client):
    app, c = make_client(FakeRunner(script(reply="Done.")))
    oid = app.state.ws.owner_for_phone(HASH)
    body = (await c.post("/api/imessage", json={"from_hash": HASH, "text": "hi"})).json()
    assert body["links"] == [f"{body['link']}/shop"]
    (app.state.ws.owner_dir(oid) / "profile.json").write_text(json.dumps(
        {"name": "S", "facts": [{"text": "Opens 9 AM Tue", "source_url": "https://a.b"}]}))
    app.state.imessage.min_gap = 0
    body = (await c.post("/api/imessage", json={"from_hash": HASH, "text": "again"})).json()
    assert body["links"] == [body["link"]]


async def test_imessage_stops_share_card_once_the_owner_has_shared(make_client):
    # A shared link the agent could not read leaves facts empty; the card must not come back on every reply.
    app, c = make_client(FakeRunner(script(reply="Done.")))
    oid = app.state.ws.owner_for_phone(HASH)
    d = app.state.ws.owner_dir(oid)
    (d / "profile.json").write_text(json.dumps({"name": "S", "facts": []}))
    with (d / "messages.jsonl").open("a") as f:
        f.write(json.dumps({"role": "owner", "text": "Here is my shop. Location: not shared. Link: https://instagram.com/s",
                            "channel": "web"}) + "\n")
    body = (await c.post("/api/imessage", json={"from_hash": HASH, "text": "hi"})).json()
    assert body["links"] == [body["link"]]


def test_docker_runner_passes_the_inbox_base_by_name(settings):
    # setup's `inbox create` hands out plus-addresses of this inbox (AgentMail's free plan holds 3 inboxes)
    cmd = DockerRunner(settings).command("o_1234567890", "hello", "sid-1", resume=False)
    assert "MS_INBOX_BASE" in cmd and cmd[cmd.index("MS_INBOX_BASE") - 1] == "-e"


def test_split_texts_strips_numbered_list_markers():
    from msapi.imessage import split_texts
    texts, _ = split_texts("Try these.\n\n1. A chatbot\n2) A booking page", "L")
    assert texts == ["Try these.", "A chatbot\nA booking page"]


# iMessage polls: a pending approval is offered once as a native yes/no poll; a vote decides it like the page's buttons.
YES, NO = "Yes, set it up", "Not now"


async def test_imessage_offers_a_pending_approval_once_as_a_poll(make_client, settings):
    app, c = make_client()
    app.state.imessage.min_gap = 0
    oid = app.state.ws.owner_for_phone(HASH)
    write_approval(settings, oid)
    first = (await c.post("/api/imessage", json={"from_hash": HASH, "text": "set it up"})).json()
    assert first["poll"] == {"question": "Set up chat-a for you?", "options": [YES, NO]}
    again = (await c.post("/api/imessage", json={"from_hash": HASH, "text": "ok"})).json()
    assert again["poll"] is None


async def test_imessage_poll_uses_the_catalog_name(make_client, settings):
    (settings.root / "sandbox").mkdir()
    (settings.root / "sandbox" / "catalog.json").write_text(json.dumps({"tools": [{"id": "chat-a", "name": "Chatling"}]}))
    app, c = make_client()
    write_approval(settings, app.state.ws.owner_for_phone(HASH))
    body = (await c.post("/api/imessage", json={"from_hash": HASH, "text": "go"})).json()
    assert body["poll"]["question"] == "Set up Chatling for you?"


async def test_imessage_vote_yes_approves_and_runs_the_turn(make_client, settings):
    runner = FakeRunner(script(reply="Setting up Chatling now."))
    app, c = make_client(runner)
    oid = app.state.ws.owner_for_phone(HASH)
    write_approval(settings, oid)
    r = await c.post("/api/imessage/vote", json={"from_hash": HASH, "poll": "Set up chat-a for you?", "option": YES})
    assert r.status_code == 200 and r.json()["replies"] == ["Setting up Chatling now."]
    assert "Owner approved approval ap_1" in runner.calls[0]["prompt"]
    ws = Workspaces(settings.workspaces)
    assert json.loads((ws.owner_dir(oid) / "approvals" / "ap_1.json").read_text())["status"] == "approved"
    assert json.loads((ws.decisions_dir(oid) / "ap_1.json").read_text())["status"] == "approved"


async def test_imessage_vote_not_now_rejects(make_client, settings):
    runner = FakeRunner(script())
    app, c = make_client(runner)
    oid = app.state.ws.owner_for_phone(HASH)
    write_approval(settings, oid)
    r = await c.post("/api/imessage/vote", json={"from_hash": HASH, "poll": "Set up chat-a for you?", "option": NO})
    assert r.status_code == 200 and "Owner rejected approval ap_1" in runner.calls[0]["prompt"]
    assert json.loads((Workspaces(settings.workspaces).owner_dir(oid) / "approvals" / "ap_1.json").read_text())["status"] == "rejected"


async def test_imessage_vote_only_reaches_the_voters_own_approval(make_client, settings):
    runner = FakeRunner(script())
    app, c = make_client(runner)
    oid = app.state.ws.owner_for_phone(HASH)
    write_approval(settings, oid)
    r = await c.post("/api/imessage/vote", json={"from_hash": "b" * 64, "poll": "Set up chat-a for you?", "option": YES})
    assert r.status_code == 200 and r.json()["replies"] == [CLOSED]
    assert runner.calls == []
    assert json.loads((Workspaces(settings.workspaces).owner_dir(oid) / "approvals" / "ap_1.json").read_text())["status"] == "pending"


async def test_imessage_vote_on_a_decided_approval_says_so(make_client, settings):
    runner = FakeRunner(script())
    app, c = make_client(runner)
    app.state.imessage.min_gap = 0
    oid = app.state.ws.owner_for_phone(HASH)
    write_approval(settings, oid)
    vote = {"from_hash": HASH, "poll": "Set up chat-a for you?", "option": YES}
    assert (await c.post("/api/imessage/vote", json=vote)).status_code == 200
    again = await c.post("/api/imessage/vote", json=vote)
    assert again.status_code == 200 and again.json()["replies"] == [CLOSED]
    assert len(runner.calls) == 1


async def test_imessage_vote_needs_the_relay_secret_and_a_known_option(make_client, settings):
    settings.relay_secret = "relay-s3cret"
    app, c = make_client()
    vote = {"from_hash": HASH, "poll": "Set up chat-a for you?", "option": YES}
    assert (await c.post("/api/imessage/vote", json=vote)).status_code == 401
    bad = {**vote, "option": "Maybe"}
    assert (await c.post("/api/imessage/vote", json=bad, headers={"x-relay-secret": "relay-s3cret"})).status_code == 422


CLOSED = "That question is already answered. Your page has the latest."
