"""Two doors, one assistant: a "not now" can become a yes on either door, and a shop started on the website can
carry on in iMessage by texting its shop code."""
import json

from conftest import script
from msapi.imessage import NOT_NOW
from msapi.runner import FakeRunner
from msapi.workspaces import Workspaces

HASH = "c" * 64
Q = "Set up chat-a for you?"
YES, NO = "Yes, set it up", "Not now"


def write_approval(settings, oid, ap_id="ap_1", status="pending", at="2026-11-08T00:00:00Z"):
    d = Workspaces(settings.workspaces).owner_dir(oid) / "approvals"
    d.mkdir(exist_ok=True)
    (d / f"{ap_id}.json").write_text(json.dumps(
        {"id": ap_id, "tool_id": "chat-a", "summary": "Create a free account", "status": status, "created_at": at}))


def status(settings, oid, ap_id="ap_1"):
    ws = Workspaces(settings.workspaces)
    return (json.loads((ws.owner_dir(oid) / "approvals" / f"{ap_id}.json").read_text())["status"],
            json.loads((ws.decisions_dir(oid) / f"{ap_id}.json").read_text())["status"])


# "Not now", then yes


async def test_web_not_now_answers_at_once_and_a_later_yes_still_counts(make_client, settings):
    runner = FakeRunner(script(reply="Setting it up."))
    app, c = make_client(runner)
    oid = app.state.ws.create_owner("x")
    write_approval(settings, oid)
    no = await c.post(f"/api/owners/{oid}/approvals/ap_1", json={"decision": "reject"})
    assert no.status_code == 200 and no.json()["reply"] == NOT_NOW and "turn_id" not in no.json()
    assert runner.calls == [] and status(settings, oid) == ("rejected", "rejected")
    texts = [m["text"] for m in app.state.ws.messages(oid)]
    assert texts == ["Declined: Create a free account", NOT_NOW]

    yes = await c.post(f"/api/owners/{oid}/approvals/ap_1", json={"decision": "approve"})
    assert yes.status_code == 200 and yes.json()["turn_id"]
    await app.state.turns.wait(yes.json()["turn_id"], 5)
    assert "Owner approved approval ap_1" in runner.calls[0]["prompt"]
    assert status(settings, oid) == ("approved", "approved")


async def test_web_yes_is_final(make_client, settings):
    app, c = make_client()
    oid = app.state.ws.create_owner("x")
    write_approval(settings, oid)
    assert (await c.post(f"/api/owners/{oid}/approvals/ap_1", json={"decision": "approve"})).status_code == 200
    for d in ("reject", "approve"):
        r = await c.post(f"/api/owners/{oid}/approvals/ap_1", json={"decision": d})
        assert r.status_code == 409
    assert status(settings, oid) == ("approved", "approved")


async def test_web_not_now_twice_is_409(make_client, settings):
    app, c = make_client()
    oid = app.state.ws.create_owner("x")
    write_approval(settings, oid)
    assert (await c.post(f"/api/owners/{oid}/approvals/ap_1", json={"decision": "reject"})).status_code == 200
    assert (await c.post(f"/api/owners/{oid}/approvals/ap_1", json={"decision": "reject"})).status_code == 409


async def test_imessage_not_now_then_yes_on_the_same_poll(make_client, settings):
    runner = FakeRunner(script(reply="Setting up chat-a now."))
    app, c = make_client(runner)
    app.state.imessage.min_gap = 0
    oid = app.state.ws.owner_for_phone(HASH)
    write_approval(settings, oid)
    no = (await c.post("/api/imessage/vote", json={"from_hash": HASH, "poll": Q, "option": NO})).json()
    assert no["replies"] == [NOT_NOW] and no["links"] == [] and no["poll"] is None and runner.calls == []
    yes = (await c.post("/api/imessage/vote", json={"from_hash": HASH, "poll": Q, "option": YES})).json()
    assert yes["replies"] == ["Setting up chat-a now."]
    assert "Owner approved approval ap_1" in runner.calls[0]["prompt"]
    assert status(settings, oid) == ("approved", "approved")


async def test_imessage_yes_on_an_old_no_is_closed_once_the_tool_has_a_yes(make_client, settings):
    runner = FakeRunner(script())
    app, c = make_client(runner)
    oid = app.state.ws.owner_for_phone(HASH)
    write_approval(settings, oid, "ap_1", status="rejected", at="2026-11-08T00:00:00Z")
    write_approval(settings, oid, "ap_2", status="approved", at="2026-11-08T01:00:00Z")
    r = (await c.post("/api/imessage/vote", json={"from_hash": HASH, "poll": Q, "option": YES})).json()
    assert r["replies"][0].startswith("That question is already answered") and runner.calls == []


async def test_imessage_not_now_after_yes_is_closed(make_client, settings):
    runner = FakeRunner(script())
    app, c = make_client(runner)
    app.state.imessage.min_gap = 0
    oid = app.state.ws.owner_for_phone(HASH)
    write_approval(settings, oid)
    await c.post("/api/imessage/vote", json={"from_hash": HASH, "poll": Q, "option": YES})
    r = (await c.post("/api/imessage/vote", json={"from_hash": HASH, "poll": Q, "option": NO})).json()
    assert r["replies"][0].startswith("That question is already answered")
    assert status(settings, oid) == ("approved", "approved")


# Shop codes: from the website to iMessage


async def test_link_code_is_stable_and_short(make_client, settings):
    app, c = make_client()
    oid = app.state.ws.create_owner("x")
    a = (await c.get(f"/api/owners/{oid}/link")).json()
    b = (await c.get(f"/api/owners/{oid}/link")).json()
    assert a == b and len(a["code"]) == 6 and a["linked"] is False
    assert (await c.get("/api/owners/o_0000000000/link")).status_code == 404


async def test_texting_the_code_joins_the_web_shop_without_a_turn(make_client, settings):
    runner = FakeRunner(script(reply="Here is your plan."))
    app, c = make_client(runner)
    app.state.imessage.min_gap = 0
    oid = app.state.ws.create_owner("bean.example")
    (app.state.ws.owner_dir(oid) / "profile.json").write_text(json.dumps({"name": "Bean & Brick"}))
    write_approval(settings, oid)
    code = (await c.get(f"/api/owners/{oid}/link")).json()["code"]

    r = (await c.post("/api/imessage", json={"from_hash": HASH, "text": f"Hi! My shop code is {code.lower()}"})).json()
    assert runner.calls == []
    assert r["replies"] == ["Got it, you're texting as Bean & Brick now. Same plan as on the website, and you can ask me anything here."]
    assert r["links"] == [f"https://web.example/b/{oid}"]
    assert r["poll"] == {"question": Q, "options": [YES, NO]}  # the web's open question comes along
    assert (await c.get(f"/api/owners/{oid}")).json()["phone_linked"] is True
    assert (await c.get(f"/api/owners/{oid}/link")).json()["linked"] is True

    # From now on this phone is that shop: its texts run turns there, and votes reach its approvals.
    r2 = (await c.post("/api/imessage", json={"from_hash": HASH, "text": "what should I do first?"})).json()
    assert r2["replies"] == ["Here is your plan."] and f"owner={oid}" in runner.calls[0]["prompt"]
    assert app.state.ws.owner_for_phone(HASH) == oid


async def test_a_page_link_in_a_text_joins_too_and_unknown_codes_do_not(make_client, settings):
    runner = FakeRunner(script(reply="Hello."))
    app, c = make_client(runner)
    app.state.imessage.min_gap = 0
    oid = app.state.ws.create_owner("x")
    r = (await c.post("/api/imessage", json={"from_hash": HASH, "text": "ZZZZZZ is my code"})).json()
    assert r["replies"] == ["Hello."]  # no such code: an ordinary text, a new shop for this phone
    mine = app.state.ws.owner_for_phone(HASH)
    assert mine != oid
    r = (await c.post("/api/imessage", json={"from_hash": HASH, "text": f"https://web.example/b/{oid}"})).json()
    assert r["replies"][0].startswith("Got it, this phone is tied to your shop now")
    assert app.state.ws.owner_for_phone(HASH) == oid
