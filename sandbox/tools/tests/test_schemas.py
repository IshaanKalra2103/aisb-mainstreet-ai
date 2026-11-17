import pytest
from pydantic import ValidationError

from mstools.schemas import Compare, CompareOption, NeedItem, Needs, SimTest, Tool


def need(i="missed-calls"):
    return NeedItem(need_id=i, title="Answer missed calls", why="You are on jobs", est_hours_saved_week=3)


def test_needs_requires_3_to_5_items():
    with pytest.raises(ValidationError):
        Needs(items=[need(), need()])
    with pytest.raises(ValidationError):
        Needs(items=[need()] * 6)
    assert len(Needs(items=[need()] * 3).items) == 3


def test_compare_takes_1_to_3_options():
    opt = CompareOption(tool_id="a", fit_sentence="Fits", works_with=["square"])
    with pytest.raises(ValidationError):
        Compare(need_id="reviews", options=[], recommended_tool_id="a")
    with pytest.raises(ValidationError):
        Compare(need_id="reviews", options=[opt] * 4, recommended_tool_id="a")
    assert Compare(need_id="reviews", options=[opt, opt], recommended_tool_id="a")


def test_compare_with_one_option_saves(env):
    from mstools import ws
    path = ws.save("compare", {"need_id": "missed-calls", "recommended_tool_id": "recep-a",
                               "options": [{"tool_id": "recep-a", "fit_sentence": "Answers calls", "works_with": []}]})
    assert path.name == "compare_missed-calls.json"


def tool_data(**over):
    d = {
        "id": "acme-chat", "name": "Acme Chat", "vendor": "Acme Inc", "url": "https://acme.example",
        "need_ids": ["website-chat"], "business_types": ["coffee_shop"],
        "what_it_does": "Answers questions on your website.",
        "price": {"free_plan": True, "from_usd_month": None, "pricing_url": "https://acme.example/pricing", "notes": ""},
        "setup": {"minutes": 15, "difficulty": "easy", "agent_setup": False, "playbook": None},
        "integrations": ["website"],
        "trust": {"score": 80, "badge": "verified", "signals": {}},
        "sim_test": None, "sources": [], "status": "approved", "reviewed_by": "x", "reviewed_at": "2026-11-08",
    }
    d.update(over)
    return d


def test_tool_rejects_unknown_need():
    Tool(**tool_data())
    with pytest.raises(ValidationError):
        Tool(**tool_data(need_ids=["pizza"]))


def test_sim_test_label_is_simulated():
    s = SimTest(score=7, persona="Denise, diner owner", task="Set up chat", notes="Easy")
    assert s.label == "simulated"
    with pytest.raises(ValidationError):
        SimTest(score=7, persona="p", task="t", notes="n", label="real")


from mstools.schemas import Fact, Profile  # noqa: E402

BASE = dict(name="Main Street Shears", business_type="salon", city="Westminster", state="MD",
            size="owner plus 2 stylists", summary="A three-stylist salon.")


def test_profile_without_facts_still_valid():
    p = Profile(**BASE)
    assert p.facts == [] and p.lat is None and p.lon is None


def test_fact_needs_http_source():
    with pytest.raises(ValidationError):
        Fact(text="13 of 40 nearby salons book online", source_url="maps search")
    assert Fact(text="13 of 40 nearby salons book online", source_url="https://www.google.com/maps/search/x")


def test_fact_text_is_short():
    with pytest.raises(ValidationError):
        Fact(text="x" * 91, source_url="https://a.b")


def test_profile_caps_facts_at_5():
    f = Fact(text="Opens 9 AM Tue", source_url="https://a.b")
    with pytest.raises(ValidationError):
        Profile(**BASE, facts=[f] * 6)
    assert len(Profile(**BASE, facts=[f] * 5).facts) == 5


def test_profile_lat_lon_in_range():
    with pytest.raises(ValidationError):
        Profile(**BASE, lat=91, lon=0)
    assert Profile(**BASE, lat=39.57501, lon=-76.99531).lon == -76.99531
