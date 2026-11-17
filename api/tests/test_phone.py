"""The website's "Text me": POST /api/phone adds the number to the line's allowed list and the line texts it first."""
import hashlib
import json
import time

import pytest

from msapi.app import us_mobile
from msapi.photon import PhotonError

NUM = "+12405550142"
H = hashlib.sha256(NUM.encode()).hexdigest()
FORM = {"first_name": "Dana Lee", "email": "dana@example.com", "phone": "(240) 555-0142"}


class FakePhoton:
    def __init__(self, error=None, already=False):
        self.calls, self.error, self.already = [], error, already

    @property
    def on(self):
        return True

    async def allow(self, e164, first, last, email):
        self.calls.append((e164, first, last, email))
        if self.error:
            raise PhotonError(self.error)
        return not self.already


async def outbox_all(c):
    sync = (await c.get("/api/imessage/outbox")).json()
    return (await c.get("/api/imessage/outbox", params={"after": 0, "epoch": sync["epoch"]})).json()


def shop(app, name="Bean & Brick Coffee"):
    oid = app.state.ws.create_owner("https://bean.example")
    (app.state.ws.owner_dir(oid) / "profile.json").write_text(json.dumps({"name": name, "facts": [{"text": "x"}]}))
    return oid


def test_us_mobile():
    assert us_mobile("(240) 555-0142") == NUM == us_mobile("1-240-555-0142") == us_mobile("+1 240 555 0142")
    assert us_mobile("555-0142") is None and us_mobile("+44 20 7946 0958") is None and us_mobile("(140) 555-0142") is None


async def test_a_number_from_a_shop_page_is_allowed_tied_and_texted_first(make_client, settings):
    photon = FakePhoton()
    app, c = make_client(photon=photon)
    oid = shop(app)
    r = await c.post("/api/phone", json={**FORM, "owner_id": oid})
    assert r.status_code == 200 and r.json() == {"ok": True, "line": "+1 (415) 225-0168"}
    assert photon.calls == [(NUM, "Dana Lee", "", "dana@example.com")]
    assert app.state.ws.phone_owner(H) == oid
    [e] = (await outbox_all(c))["entries"]
    assert e["from_hash"] == H and e["to"] == NUM and e["links"] == [f"{settings.web_url}/b/{oid}"]
    assert e["replies"][0] == "Hi Dana, it's MainStreet AI. You asked for texts about Bean & Brick Coffee."
    # the raw number goes to the relay once, then the API forgets it
    again = (await c.get("/api/imessage/outbox", params={"after": 0, "epoch": app.state.imessage.epoch})).json()
    assert "to" not in again["entries"][0]
    assert NUM not in (settings.workspaces / "_invites.json").read_text()
    assert json.loads((settings.workspaces / "_invites.json").read_text()) == {"added": [H]}


async def test_the_reply_from_that_phone_texts_as_the_shop(make_client):
    app, c = make_client(photon=FakePhoton())
    oid = shop(app)
    await c.post("/api/phone", json={**FORM, "owner_id": oid})
    runner = app.state.turns.runner
    await c.post("/api/imessage", json={"from_hash": H, "text": "what can AI do for me"})
    assert runner.calls[-1]["owner_id"] == oid


async def test_the_home_page_form_asks_for_the_shop(make_client):
    app, c = make_client(photon=FakePhoton())
    r = await c.post("/api/phone", json=FORM)
    assert r.status_code == 200 and app.state.ws.phone_owner(H) is None
    [e] = (await outbox_all(c))["entries"]
    assert e["to"] == NUM and e["links"] == [] and "What's your shop's website?" in e["replies"][1]


async def test_a_phone_that_already_texts_keeps_its_shop(make_client):
    photon = FakePhoton()
    app, c = make_client(photon=photon)
    mine, theirs = shop(app), shop(app, "Other")
    app.state.ws.link_phone(H, mine)
    r = await c.post("/api/phone", json={**FORM, "owner_id": theirs})
    assert r.status_code == 409 and photon.calls == [] and app.state.ws.phone_owner(H) == mine
    assert (await outbox_all(c))["entries"] == []


async def test_the_cap_holds(make_client, settings):
    settings.phone_adds_cap = 1
    photon = FakePhoton()
    app, c = make_client(photon=photon)
    assert (await c.post("/api/phone", json=FORM)).status_code == 200
    r = await c.post("/api/phone", json={**FORM, "phone": "240-555-0143"})
    assert r.status_code == 429 and len(photon.calls) == 1


async def test_a_number_already_on_the_list_does_not_use_a_spot(make_client, settings):
    app, c = make_client(photon=FakePhoton(already=True))
    assert (await c.post("/api/phone", json=FORM)).status_code == 200
    assert not (settings.workspaces / "_invites.json").exists()


async def test_adds_per_network_a_day(make_client, settings):
    settings.phone_adds_per_ip_day = 2
    app, c = make_client(photon=FakePhoton())
    ip = {"CF-Connecting-IP": "203.0.113.9"}
    for n in ("0142", "0143"):
        assert (await c.post("/api/phone", json={**FORM, "phone": f"240555{n}"}, headers=ip)).status_code == 200
    assert (await c.post("/api/phone", json={**FORM, "phone": "2405550144"}, headers=ip)).status_code == 429
    other = {"CF-Connecting-IP": "203.0.113.10"}
    assert (await c.post("/api/phone", json={**FORM, "phone": "2405550144"}, headers=other)).status_code == 200


@pytest.mark.parametrize("kind,code", [("full", 429), ("unavailable", 409), ("auth", 503), ("down", 502)])
async def test_photon_errors_become_plain_answers(make_client, settings, kind, code):
    app, c = make_client(photon=FakePhoton(error=kind))
    r = await c.post("/api/phone", json=FORM)
    assert r.status_code == code and "detail" in r.json()
    assert app.state.ws.phone_owner(H) is None and (await outbox_all(c))["entries"] == []


async def test_bad_input(make_client):
    app, c = make_client(photon=FakePhoton())
    assert (await c.post("/api/phone", json={**FORM, "phone": "12345"})).status_code == 422
    assert (await c.post("/api/phone", json={**FORM, "email": "nope"})).status_code == 422
    assert (await c.post("/api/phone", json={**FORM, "owner_id": "o_missing00"})).status_code == 404


async def test_off_without_a_session(make_client):
    app, c = make_client()  # no PHOTON_SESSION in the test settings
    r = await c.post("/api/phone", json=FORM)
    assert r.status_code == 503 and "+1 (415) 225-0168" in r.json()["detail"]


async def test_the_number_leaves_memory_after_welcome_ttl(make_client, monkeypatch):
    import msapi.imessage as im
    app, c = make_client(photon=FakePhoton())
    await c.post("/api/phone", json=FORM)
    monkeypatch.setattr(im, "WELCOME_TTL", 0.0)
    app.state.imessage._trim(time.time())
    assert all("to" not in e for e in app.state.imessage.outbox)


ONBOARD = {"first_name": "Dana", "phone": "(240) 555-0142", "welcome": False}


async def test_the_imessage_onboarding_adds_the_number_without_a_welcome(make_client, settings):
    settings.inbox_base = "shopbot@agentmail.to"
    photon = FakePhoton()
    app, c = make_client(photon=photon)
    r = await c.post("/api/phone", json=ONBOARD)
    assert r.status_code == 200 and r.json() == {"ok": True, "line": "+1 (415) 225-0168"}
    # no email asked: Photon gets a plus-address of our own inbox, never the number
    assert photon.calls == [(NUM, "Dana", "", f"shopbot+text-{H[:8]}@agentmail.to")]
    assert NUM not in photon.calls[0][3]
    assert (await outbox_all(c))["entries"] == []  # the owner texts first, so the line sends nothing
    assert json.loads((settings.workspaces / "_invites.json").read_text()) == {"added": [H]}


async def test_the_onboarding_lets_a_phone_that_already_texts_straight_through(make_client, settings):
    settings.inbox_base = "shopbot@agentmail.to"
    photon = FakePhoton()
    app, c = make_client(photon=photon)
    app.state.ws.link_phone(H, shop(app))
    r = await c.post("/api/phone", json=ONBOARD)
    assert r.status_code == 200 and photon.calls == [] and (await outbox_all(c))["entries"] == []


async def test_no_email_and_no_inbox_asks_for_one(make_client, settings):
    settings.inbox_base = None
    photon = FakePhoton()
    app, c = make_client(photon=photon)
    r = await c.post("/api/phone", json=ONBOARD)
    assert r.status_code == 422 and photon.calls == []


async def test_the_old_form_still_welcomes(make_client, settings):
    settings.inbox_base = "shopbot@agentmail.to"
    app, c = make_client(photon=FakePhoton())
    assert (await c.post("/api/phone", json={**FORM, "welcome": True})).status_code == 200
    assert len((await outbox_all(c))["entries"]) == 1
