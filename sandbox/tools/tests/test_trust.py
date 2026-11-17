from mstools.schemas import Signal, Tool
from mstools.trust import can_agent_setup, score_signals

from test_schemas import tool_data


def sig(**pts):
    full = {"identity": 25, "longevity": 15, "data_handling": 20, "pricing": 15, "reviews": 15, "viability": 10}
    full.update(pts)
    return {k: Signal(points=v, max=0, value="x") for k, v in full.items()}


def test_75_approved_is_verified():
    t = score_signals(sig(reviews=0, viability=0), human_approved=True)
    assert t.score == 75 and t.badge == "verified"


def test_75_unapproved_is_caution():
    t = score_signals(sig(reviews=0, viability=0), human_approved=False)
    assert t.score == 75 and t.badge == "caution"


def test_identity_zero_is_unknown_even_at_90():
    t = score_signals({"identity": Signal(points=0, max=25, value=""), **{k: v for k, v in sig().items() if k != "identity"}}, True)
    assert t.score == 75 and t.badge == "unknown"
    t2 = score_signals({**sig(longevity=15), "identity": Signal(points=0, max=25, value="")}, True)
    assert t2.badge == "unknown"


def test_49_is_unknown():
    t = score_signals(sig(identity=10, longevity=0, data_handling=10, pricing=5, reviews=7, viability=10, ), True)
    assert t.score == 42 and t.badge == "unknown"
    t2 = score_signals(sig(identity=10, longevity=5, data_handling=10, pricing=5, reviews=9, viability=10), True)
    assert t2.score == 49 and t2.badge == "unknown"


def test_points_clamped_to_weight():
    t = score_signals(sig(identity=40), True)
    assert t.signals["identity"].points == 25 and t.signals["identity"].max == 25
    assert t.score == 100


def test_can_agent_setup_requires_verified_flag_and_playbook():
    setup_on = {"minutes": 10, "difficulty": "easy", "agent_setup": True, "playbook": "setup-acme-chat"}
    off = Tool(**tool_data(setup={**setup_on, "agent_setup": False}))
    assert not can_agent_setup(off)
    no_playbook = Tool(**tool_data(setup={**setup_on, "playbook": None}))
    assert not can_agent_setup(no_playbook)
    assert can_agent_setup(Tool(**tool_data(setup=setup_on)))


def test_a_recorded_flow_counts_like_a_playbook():
    flow_only = {"minutes": 10, "difficulty": "easy", "agent_setup": True, "playbook": None, "flow": "rzrv"}
    assert can_agent_setup(Tool(**tool_data(setup=flow_only)))


def test_a_team_approved_caution_tool_can_be_set_up_but_never_an_unknown_or_unreviewed_one():
    # The team approves a tool after testing its setup live (RZRV): its badge stays what the evidence says.
    flow = {"minutes": 10, "difficulty": "easy", "agent_setup": True, "playbook": None, "flow": "rzrv"}
    caution = {"score": 55, "badge": "caution", "signals": {}}
    assert can_agent_setup(Tool(**tool_data(setup=flow, trust=caution)))
    assert not can_agent_setup(Tool(**tool_data(setup=flow, trust=caution, status="pending")))
    assert not can_agent_setup(Tool(**tool_data(setup=flow, trust={"score": 45, "badge": "unknown", "signals": {}})))
    assert not can_agent_setup(Tool(**tool_data(setup={**flow, "agent_setup": False}, trust=caution)))
