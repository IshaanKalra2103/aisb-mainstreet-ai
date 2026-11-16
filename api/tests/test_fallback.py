"""DockerRunner: the subscription token runs turns until Claude rejects it for usage limits; then the API key takes over."""
import time

import pytest

from msapi.runner import DockerRunner

from conftest import script

OID, SID = "o_1234567890", "sid-1"


def reject(resets_at: float | None = None) -> dict:
    info = {"status": "rejected", "rateLimitType": "five_hour"}
    if resets_at is not None:
        info["resetsAt"] = resets_at
    return {"type": "rate_limit_event", "rate_limit_info": info}


LIMITED_TAIL = [
    {"type": "assistant", "message": {"content": [{"type": "text", "text": "You've hit your 5-hour limit"}]},
     "error": "rate_limit"},
    {"type": "result", "subtype": "success", "is_error": True, "result": "You've hit your 5-hour limit"},
    {"type": "runner_error", "message": "exit 1: "},
]


def session_path(settings):
    return settings.workspaces / OID / ".claude-config" / "projects" / "-sandbox" / f"{SID}.jsonl"


class Scripted(DockerRunner):
    """DockerRunner with _attempt replaced: each call plays the next script and may append to the session file."""

    def __init__(self, settings, scripts, writes=None):
        super().__init__(settings)
        self.scripts, self.writes, self.calls, self.seen = list(scripts), list(writes or []), [], []

    async def _attempt(self, owner_id, prompt, session_id, use_key):
        self.calls.append(use_key)
        p = session_path(self.s)
        self.seen.append(p.read_text() if p.exists() else None)
        add = self.writes.pop(0) if self.writes else None
        if add:
            p.parent.mkdir(parents=True, exist_ok=True)
            with p.open("a") as f:
                f.write(add)
        for ev in self.scripts.pop(0):
            yield ev


async def collect(runner) -> list[dict]:
    return [ev async for ev in runner.run(OID, "hello", SID, resume=False)]


@pytest.fixture
def key(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-api03-test")


async def test_rejected_token_retries_on_key_and_rolls_back_new_session(settings, key):
    resets = time.time() + 3600
    r = Scripted(settings, [[{"type": "system", "subtype": "init"}, reject(resets), *LIMITED_TAIL], script()],
                 writes=["prompt\nlimit message\n", None])
    out = await collect(r)
    assert r.calls == [False, True]
    assert r.seen == [None, None]  # the rejected attempt's new session file is gone before the retry
    assert not [e for e in out if e.get("is_error") or e["type"] == "runner_error"]
    assert out[-1] == script()[-1]
    assert r.token_limited_until == resets


async def test_rollback_keeps_earlier_conversation(settings, key):
    p = session_path(settings)
    p.parent.mkdir(parents=True)
    p.write_text("earlier turns\n")
    r = Scripted(settings, [[reject(time.time() + 60), *LIMITED_TAIL], script()], writes=["prompt again\n", None])
    await collect(r)
    assert r.seen == ["earlier turns\n", "earlier turns\n"]


async def test_key_is_used_until_token_resets(settings, key):
    r = Scripted(settings, [[reject(time.time() + 3600), *LIMITED_TAIL], script(), script()])
    await collect(r)
    await collect(r)
    assert r.calls == [False, True, True]
    r.token_limited_until = time.time() - 1  # reset passed: back to the token
    r.scripts.append(script())
    await collect(r)
    assert r.calls[-1] is False


async def test_missing_resets_at_still_limits_for_a_while(settings, key):
    r = Scripted(settings, [[reject(None), *LIMITED_TAIL], script()])
    await collect(r)
    assert r.token_limited_until > time.time() + 600


async def test_no_retry_after_the_agent_already_worked(settings, key):
    started = script()[:4]  # tool calls already ran; a retry could repeat them
    r = Scripted(settings, [[*started, reject(time.time() + 3600), *LIMITED_TAIL]])
    out = await collect(r)
    assert r.calls == [False]
    assert out[-1]["type"] == "runner_error"  # the turn fails as before ...
    assert r.token_limited_until > time.time()  # ... and the next one goes to the key


async def test_no_key_means_no_retry(settings, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    r = Scripted(settings, [[reject(time.time() + 3600), *LIMITED_TAIL]])
    out = await collect(r)
    assert r.calls == [False]
    assert any(e.get("is_error") for e in out)


def test_key_command_passes_only_the_key(settings):
    r = DockerRunner(settings)
    token = r.command(OID, "hi", SID, resume=False)
    keyed = r.command(OID, "hi", SID, resume=False, use_key=True)
    assert "CLAUDE_CODE_OAUTH_TOKEN" in token and "ANTHROPIC_API_KEY" not in token
    assert "ANTHROPIC_API_KEY" in keyed and "CLAUDE_CODE_OAUTH_TOKEN" not in keyed
