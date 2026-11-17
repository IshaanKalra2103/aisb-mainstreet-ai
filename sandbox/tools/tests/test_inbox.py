from datetime import datetime, timezone
from types import SimpleNamespace as NS

from mstools.inbox import full_obj


def test_inbox_extracts_codes_and_links():
    m = NS(message_id="m1", from_="Chat-A <hi@chat-a.example>", subject="Your code is 482913", preview="",
           created_at=datetime.now(timezone.utc), to=["x@agentmail.to"],
           extracted_text="Use 482913 to confirm. Or click https://chat-a.example/verify?t=abc", text=None,
           html='<a href="https://chat-a.example/verify?t=abc">Verify</a>')
    out = full_obj(m)
    assert out["codes"] == ["482913"]
    assert out["links"] == ["https://chat-a.example/verify?t=abc"]


# Plus-addresses: with MS_INBOX_BASE set, sign-ups share one AgentMail inbox (the free plan holds only 3).
import argparse

import pytest

from mstools import inbox

BASE = "base123@agentmail.to"


def _msg(mid, to, minutes_ago=0, from_="Chatling <hi@chatling.ai>"):
    from datetime import timedelta
    return NS(message_id=mid, from_=from_, subject=f"code {mid}", preview="", to=[to], text=None, html=None,
              extracted_text=f"Your code is 1234{mid[-1]}",
              created_at=datetime.now(timezone.utc) - timedelta(minutes=minutes_ago))


class FakeClient:
    def __init__(self, msgs=()):
        self.msgs, self.listed, self.got = list(msgs), [], []
        outer = self

        class Messages:
            def list(self, inbox_id, **kw):
                outer.listed.append(inbox_id)
                return NS(messages=outer.msgs)

            def get(self, inbox_id, message_id, **kw):
                outer.got.append(inbox_id)
                return next(m for m in outer.msgs if m.message_id == message_id)

        class Inboxes:
            messages = Messages()

            def create(self, **kw):
                raise AssertionError("must not create a new inbox when MS_INBOX_BASE is set")

        self.inboxes = Inboxes()


@pytest.fixture
def fake(monkeypatch):
    def use(msgs=()):
        c = FakeClient(msgs)
        monkeypatch.setattr(inbox, "client", lambda: c)
        return c
    return use


def test_create_with_base_hands_out_a_fresh_plus_address(monkeypatch, fake):
    monkeypatch.setenv("MS_INBOX_BASE", BASE)
    fake()
    a = argparse.Namespace(cmd="create", username="Chatling!", display_name=None)
    one, two = inbox._main(a)["inbox"], inbox._main(a)["inbox"]
    assert one.startswith("base123+chatling") and one.endswith("@agentmail.to")
    assert one != two


def test_wait_on_a_plus_address_reads_the_base_inbox_and_only_its_own_mail(monkeypatch, fake):
    monkeypatch.setenv("MS_INBOX_BASE", BASE)
    mine, other = "base123+chatlinga1@agentmail.to", "base123+tidiob2@agentmail.to"
    c = fake([_msg("m1", mine, minutes_ago=1), _msg("m2", other)])
    a = argparse.Namespace(cmd="wait", inbox=mine, since="5m", from_="chatling", subject=None, timeout=1)
    out = inbox._main(a)
    assert out["message"]["message_id"] == "m1"
    assert set(c.listed) == {BASE} and set(c.got) == {BASE}


def test_read_and_messages_on_a_plus_address_use_the_base_inbox(monkeypatch, fake):
    monkeypatch.setenv("MS_INBOX_BASE", BASE)
    mine = "base123+chatlinga1@agentmail.to"
    c = fake([_msg("m1", mine), _msg("m2", "base123+tidiob2@agentmail.to")])
    assert inbox._main(argparse.Namespace(cmd="read", inbox=mine, message_id="m1"))["message"]["message_id"] == "m1"
    listed = inbox._main(argparse.Namespace(cmd="messages", inbox=mine, limit=10))["messages"]
    assert [m["message_id"] for m in listed] == ["m1"]
    assert set(c.listed) == {BASE} and set(c.got) == {BASE}
