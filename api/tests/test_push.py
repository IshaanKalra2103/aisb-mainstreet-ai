"""Texting first: website turns of a texting owner go to the iMessage outbox, which the relay polls."""
import asyncio
import json

from conftest import script
from msapi.runner import FakeRunner
from msapi.workspaces import Workspaces

HASH = "a" * 64
OTHER = "b" * 64


class GateRunner(FakeRunner):
    """Holds every turn open until `gate` is set."""

    def __init__(self, events=None):
        super().__init__(events or script())
        self.gate = asyncio.Event()

    async def run(self, owner_id, prompt, session_id, resume):
        await self.gate.wait()
        async for ev in super().run(owner_id, prompt, session_id, resume):
            yield ev


def write_approval(settings, oid, ap_id="ap_1"):
    d = Workspaces(settings.workspaces).owner_dir(oid) / "approvals"
    d.mkdir(exist_ok=True)
    (d / f"{ap_id}.json").write_text(json.dumps(
        {"id": ap_id, "tool_id": "chat-a", "summary": "Create a free account", "status": "pending",
         "created_at": "2026-11-08T00:00:00Z"}))


async def outbox(c, after=None, epoch=None, headers=None):
    params = {} if after is None else {"after": after, "epoch": epoch}
    r = await c.get("/api/imessage/outbox", params=params, headers=headers or {})
    assert r.status_code == 200, r.text
    return r.json()


async def until_idle(app, oid):
    for _ in range(200):
        if not app.state.turns.active_turn(oid):
            return
        await asyncio.sleep(0.01)
    raise AssertionError("turn did not finish")


class SavingRunner(FakeRunner):
    """Writes needs.json during the turn, as `ws save needs` does in the sandbox."""

    def __init__(self, root, events=None):
        super().__init__(events or script())
        self.root = root

    async def run(self, owner_id, prompt, session_id, resume):
        (self.root / owner_id / "needs.json").write_text(json.dumps({"items": [{"id": "n1"}]}))
        async for ev in super().run(owner_id, prompt, session_id, resume):
            yield ev


async def test_a_website_turn_of_a_texting_owner_is_pushed(make_client, settings):
    app, c = make_client(SavingRunner(settings.workspaces, script(reply="Here is your plan.\n\nThree jobs AI can take.")))
    oid = app.state.ws.owner_for_phone(HASH)
    start = await outbox(c)
    assert start["entries"] == [] and start["busy"] is False
    r = await c.post(f"/api/owners/{oid}/turns", json={"text": "what can AI do for me", "channel": "web"})
    assert r.status_code == 200
    await until_idle(app, oid)
    box = await outbox(c, start["next"], start["epoch"])
    link = f"{settings.web_url}/b/{oid}"
    assert box["entries"] == [{"id": 1, "from_hash": HASH, "replies": ["Here is your plan.", "Three jobs AI can take."],
                               "links": [link], "video_url": None, "poll": None}]
    # a push never carries the share page card, even before the owner has shared their shop
    assert app.state.imessage._needs_shop(oid)
    again = await outbox(c, box["next"], box["epoch"])
    assert again["entries"] == []


async def test_a_web_owner_without_a_phone_gets_no_push(make_client):
    app, c = make_client()
    oid = (await c.post("/api/owners", json={"source": "https://coffee.example"})).json()["owner_id"]
    start = await outbox(c)
    await c.post(f"/api/owners/{oid}/turns", json={"text": "hi", "channel": "web"})
    await until_idle(app, oid)
    assert (await outbox(c, start["next"], start["epoch"]))["entries"] == []


async def test_a_web_only_owner_keeps_the_poll_for_a_phone_linked_later(make_client, settings):
    app, c = make_client()
    oid = (await c.post("/api/owners", json={"source": "https://coffee.example"})).json()["owner_id"]
    write_approval(settings, oid)
    await c.post(f"/api/owners/{oid}/turns", json={"text": "hi", "channel": "web"})
    await until_idle(app, oid)
    assert not (Workspaces(settings.workspaces).owner_dir(oid) / ".offered.json").exists()


async def test_a_pushed_web_turn_carries_the_poll_for_a_new_approval(make_client, settings):
    app, c = make_client()
    oid = app.state.ws.owner_for_phone(HASH)
    write_approval(settings, oid)
    start = await outbox(c)
    await c.post(f"/api/owners/{oid}/turns", json={"text": "set up a chatbot", "channel": "web"})
    await until_idle(app, oid)
    box = await outbox(c, start["next"], start["epoch"])
    assert box["entries"][0]["poll"] == {"question": "Set up chat-a for you?", "options": ["Yes, set it up", "Not now"]}


async def test_imessage_turns_are_not_pushed_twice(make_client):
    app, c = make_client()
    start = await outbox(c)
    r = await c.post("/api/imessage", json={"from_hash": HASH, "text": "I run a salon"})
    assert r.status_code == 200
    assert (await outbox(c, start["next"], start["epoch"]))["entries"] == []


async def test_an_imessage_turn_that_outlives_the_wait_is_pushed_when_it_ends(make_client):
    runner = GateRunner(script(reply="Chatling is set up."))
    app, c = make_client(runner)
    app.state.imessage.wait_s = 0.05
    start = await outbox(c)
    first = (await c.post("/api/imessage", json={"from_hash": HASH, "text": "set it up"})).json()
    assert first["replies"] == ["Still working on that. I'll text you when it's done."]
    assert (await outbox(c, start["next"], start["epoch"]))["busy"] is True
    runner.gate.set()
    oid = app.state.ws.owner_for_phone(HASH)
    await until_idle(app, oid)
    box = await outbox(c, start["next"], start["epoch"])
    assert [e["replies"] for e in box["entries"]] == [["Chatling is set up."]]
    assert box["busy"] is False


async def test_a_web_yes_is_texted_at_once_then_the_setup_result(make_client, settings):
    (settings.root / "sandbox").mkdir()
    (settings.root / "sandbox" / "catalog.json").write_text(json.dumps({"tools": [{"id": "chat-a", "name": "Chatling"}]}))
    runner = GateRunner(script(reply="Chatling is set up. Your log-in is on your page."))
    app, c = make_client(runner)
    oid = app.state.ws.owner_for_phone(HASH)
    write_approval(settings, oid)
    start = await outbox(c)
    r = await c.post(f"/api/owners/{oid}/approvals/ap_1", json={"decision": "approve"})
    assert r.status_code == 200
    box = await outbox(c, start["next"], start["epoch"])  # before the setup turn ends
    assert [e["replies"] for e in box["entries"]] == [[
        "Got your yes on the website. Setting up Chatling now. I'll text you when it's done, or if I need you for a step."]]
    assert box["busy"] is True
    runner.gate.set()
    await until_idle(app, oid)
    box2 = await outbox(c, box["next"], box["epoch"])
    assert [e["replies"] for e in box2["entries"]] == [["Chatling is set up. Your log-in is on your page."]]


def test_web_decided_pushes_a_fixed_no_and_never_raises(settings):
    from msapi.app import create_app

    app = create_app(runner=FakeRunner(script()), settings=settings)
    im = app.state.imessage
    oid = app.state.ws.owner_for_phone(HASH)
    im.web_decided(oid, {"tool_id": "chat-a"}, "reject")  # no fixed text: nothing to send
    assert im.outbox == []
    im.web_decided(oid, {"tool_id": "chat-a"}, "reject", reply="Okay, not now.")
    assert [e["replies"] for e in im.outbox] == [["Okay, not now."]]
    im.web_decided("o_bad", {}, "approve")  # unknown owner: logged, not raised
    web_only = app.state.ws.create_owner("x")
    im.web_decided(web_only, {"tool_id": "chat-a"}, "approve")
    assert len(im.outbox) == 1


async def test_every_phone_of_the_owner_gets_the_push(make_client, settings):
    app, c = make_client()
    oid = app.state.ws.owner_for_phone(HASH)
    phones = json.loads((settings.workspaces / "_phones.json").read_text())
    phones[OTHER] = oid
    (settings.workspaces / "_phones.json").write_text(json.dumps(phones))
    assert app.state.imessage.push(oid, {"replies": ["hi"]}) == 2
    assert sorted(e["from_hash"] for e in app.state.imessage.outbox) == [HASH, OTHER]


async def test_outbox_after_an_api_restart_sends_the_new_entries(make_client):
    app, c = make_client()
    oid = app.state.ws.owner_for_phone(HASH)
    app.state.imessage.push(oid, {"replies": ["one"]})
    box = await outbox(c, 7, "old-epoch")  # the relay's cursor is from a previous API process
    assert [e["replies"] for e in box["entries"]] == [["one"]] and box["next"] == 1


async def test_outbox_sync_skips_old_entries_and_old_entries_expire(make_client, monkeypatch):
    import msapi.imessage as im_mod

    app, c = make_client()
    oid = app.state.ws.owner_for_phone(HASH)
    app.state.imessage.push(oid, {"replies": ["old"]})
    sync = await outbox(c)
    assert sync["entries"] == [] and sync["next"] == 1
    app.state.imessage.outbox[0]["at"] -= im_mod.OUTBOX_TTL + 1
    assert (await outbox(c, 0, sync["epoch"]))["entries"] == []


async def test_outbox_needs_the_relay_secret(make_client, settings):
    settings.relay_secret = "relay-s3cret"
    app, c = make_client()
    assert (await c.get("/api/imessage/outbox")).status_code == 401
    assert (await c.get("/api/imessage/outbox", headers={"x-relay-secret": "nope"})).status_code == 401
    ok = await outbox(c, headers={"x-relay-secret": "relay-s3cret"})
    assert set(ok) == {"epoch", "next", "busy", "entries"}


# The plan card comes with a reply only when that turn changed the plan, or the agent pointed at the page.
async def test_a_question_goes_out_without_the_old_plan_card(make_client, settings):
    app, c = make_client(FakeRunner(script(reply="Hi again! What's your website link?")))
    oid = app.state.ws.owner_for_phone(HASH)
    d = app.state.ws.owner_dir(oid)
    (d / "profile.json").write_text(json.dumps({"name": "College Park coffee shop", "facts": [{"text": "x"}]}))
    (d / "needs.json").write_text(json.dumps({"items": [{"id": "n1"}]}))
    body = (await c.post("/api/imessage", json={"from_hash": HASH, "text": "hi"})).json()
    assert body["replies"] == ["Hi again! What's your website link?"] and body["links"] == []


async def test_a_turn_that_changes_the_plan_sends_the_card(make_client, settings):
    app, c = make_client(SavingRunner(settings.workspaces, script(reply="Here is your plan.")))
    oid = app.state.ws.owner_for_phone(HASH)
    (app.state.ws.owner_dir(oid) / "profile.json").write_text(json.dumps({"name": "S", "facts": [{"text": "x"}]}))
    body = (await c.post("/api/imessage", json={"from_hash": HASH, "text": "my site is s.example"})).json()
    assert body["links"] == [f"{settings.web_url}/b/{oid}"]


async def test_a_reply_that_points_at_the_page_sends_the_card(make_client, settings):
    app, c = make_client()
    oid = app.state.ws.owner_for_phone(HASH)
    (app.state.ws.owner_dir(oid) / "profile.json").write_text(json.dumps({"name": "S", "facts": [{"text": "x"}]}))
    link = f"{settings.web_url}/b/{oid}"
    app.state.turns.runner.events = script(reply=f"It's all on your page: {link}")
    body = (await c.post("/api/imessage", json={"from_hash": HASH, "text": "where is my plan"})).json()
    assert body["links"] == [link] and body["replies"] == ["It's all on your page"]


# "start over": the phone lets go of its shop; the next text starts a new one.
async def test_start_over_unties_the_phone_and_the_next_text_starts_a_new_shop(make_client, settings):
    runner = FakeRunner(script())
    app, c = make_client(runner)
    app.state.imessage.min_gap = 0
    old = app.state.ws.owner_for_phone(HASH)
    r = (await c.post("/api/imessage", json={"from_hash": HASH, "text": "Start over!"})).json()
    assert r["replies"] == ["Okay, starting fresh. What's your shop's website? If you don't have one, tell me the shop's name and town."]
    assert r["links"] == [] and r["poll"] is None and runner.calls == []
    assert app.state.ws.phones_for_owner(old) == [] and app.state.ws.exists(old)  # the old shop stays
    nxt = (await c.post("/api/imessage", json={"from_hash": HASH, "text": "https://new.example"})).json()
    assert f"/b/{old}" not in nxt["link"] and runner.calls[0]["owner_id"] != old


async def test_start_over_only_on_its_own(make_client):
    runner = FakeRunner(script())
    app, c = make_client(runner)
    old = app.state.ws.owner_for_phone(HASH)
    await c.post("/api/imessage", json={"from_hash": HASH, "text": "can I start over with a new menu?"})
    assert runner.calls[0]["owner_id"] == old and app.state.ws.phones_for_owner(old) == [HASH]


async def test_start_over_from_an_unknown_phone_is_fine(make_client):
    app, c = make_client()
    r = await c.post("/api/imessage", json={"from_hash": OTHER, "text": "reset"})
    assert r.status_code == 200 and r.json()["links"] == []
