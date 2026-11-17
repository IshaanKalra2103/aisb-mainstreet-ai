"""One yes can cover several tools; runs are counted per tool and per provider (bu and tf separately)."""
import json
import sys

import pytest

from mstools import approval, tf
from mstools.cli import ToolError


def _request(monkeypatch, capsys, *argv):
    monkeypatch.setattr(sys, "argv", ["approval", "request", *argv])
    with pytest.raises(SystemExit):
        approval.main()
    return json.loads(capsys.readouterr().out.strip().splitlines()[-1])


def _approve(env, aid, **fields):
    (env["decisions"] / f"{aid}.json").write_text(json.dumps({"id": aid, "summary": "s", "status": "approved", **fields}))


def _run(env, run_id, **fields):
    d = env["work"] / "runs"
    d.mkdir(exist_ok=True)
    (d / f"{run_id}.json").write_text(json.dumps({"run_id": run_id, **fields}))


def test_request_keeps_first_tool_and_lists_all(env, monkeypatch, capsys):
    out = _request(monkeypatch, capsys, "--tool", "picktime", "--tool", "chatling", "--summary", "Set up both")
    saved = json.loads((env["work"] / "approvals" / f"{out['approval_id']}.json").read_text())
    assert saved["tool_id"] == "picktime" and saved["tool_ids"] == ["picktime", "chatling"]


def test_check_accepts_any_listed_tool_and_old_single_tool_approvals(env):
    _approve(env, "ap_two", tool_id="picktime", tool_ids=["picktime", "chatling"])
    _approve(env, "ap_old", tool_id="rzrv")
    tf.check_approval("ap_two", "chatling", "bu")
    tf.check_approval("ap_old", "rzrv")
    with pytest.raises(ToolError, match="not rzrv"):
        tf.check_approval("ap_two", "rzrv", "bu")


def test_runs_are_counted_per_tool_and_provider(env):
    _approve(env, "ap_two", tool_id="picktime", tool_ids=["picktime", "chatling"])
    _run(env, "bu_1", approval="ap_two", tool_id="picktime", provider="bu")
    _run(env, "bu_2", approval="ap_two", tool_id="picktime", provider="bu")
    _run(env, "tf_1", approval="ap_two", tool_id="picktime")  # tf runs carry no provider
    _run(env, "bu_3", approval="ap_two", tool_id="chatling", provider="bu")
    with pytest.raises(ToolError, match="already used"):
        tf.check_approval("ap_two", "picktime", "bu")
    tf.check_approval("ap_two", "picktime", "tf")   # one tf run so far
    tf.check_approval("ap_two", "chatling", "bu")   # one bu run for chatling
