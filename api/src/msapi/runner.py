"""One agent turn = one `claude -p` inside the owner's sandbox container, streamed as stream-json events."""
import asyncio
import contextlib
import json
import os
import re
import time
from collections import defaultdict
from typing import AsyncIterator, Protocol

from .settings import Settings

ALLOWED_TOOLS = "Bash(ws:*),Bash(catalog:*),Bash(tf:*),Bash(inbox:*),Bash(preview:*),Bash(approval:*),Read,Write,Edit,Skill"
DISALLOWED_TOOLS = "WebFetch,WebSearch"
PASS_ENV = ("TINYFISH_API_KEY", "OPENROUTER_API_KEY", "AGENTMAIL_API_KEY", "MS_INBOX_BASE")


def clean_token(raw: str | None) -> str:
    """Keychain copies of the token picked up stray spaces and prefixes; keep only the sk-ant-oat... part."""
    t = re.sub(r"\s+", "", raw or "")
    i = t.find("sk-ant-oat")
    return t[i:] if i >= 0 else t


def token_looks_valid(raw: str | None = None) -> bool:
    t = clean_token(raw if raw is not None else os.environ.get("CLAUDE_CODE_OAUTH_TOKEN"))
    return t.startswith("sk-ant-oat") and len(t) > 80


class Runner(Protocol):
    def run(self, owner_id: str, prompt: str, session_id: str, resume: bool) -> AsyncIterator[dict]: ...


LIMIT_FALLBACK_S = 30 * 60  # when Claude rejects the token without saying when it resets


def rejected_until(ev: dict) -> float | None:
    """The reset time (epoch s) if this event says Claude rejected the request for usage limits, else None."""
    info = (ev.get("rate_limit_info") or {}) if ev.get("type") == "rate_limit_event" else {}
    if info.get("status") != "rejected":
        return None
    return float(info.get("resetsAt") or time.time() + LIMIT_FALLBACK_S)


class DockerRunner:
    """Runs turns on the subscription token (CLAUDE_CODE_OAUTH_TOKEN). When Claude rejects it for usage limits
    before the agent did anything, the turn reruns on ANTHROPIC_API_KEY, and later turns use the key until the
    token's limit resets."""

    def __init__(self, settings: Settings):
        self.s = settings
        self.token_limited_until = 0.0

    def env(self) -> dict:
        return {**os.environ, "CLAUDE_CODE_OAUTH_TOKEN": clean_token(os.environ.get("CLAUDE_CODE_OAUTH_TOKEN"))}

    def has_key(self) -> bool:
        return bool(os.environ.get("ANTHROPIC_API_KEY", "").strip())

    def name(self, owner_id: str) -> str:
        return f"ms-{owner_id}"

    def command(self, owner_id: str, prompt: str, session_id: str, resume: bool, use_key: bool = False) -> list[str]:
        work = self.s.workspaces / owner_id
        # Secrets go by name only (-e NAME), so values never show up in `ps`. Exactly one Claude credential.
        cred = "ANTHROPIC_API_KEY" if use_key else "CLAUDE_CODE_OAUTH_TOKEN"
        env = ["-e", cred, "-e", "CLAUDE_CONFIG_DIR=/work/.claude-config",
               "-e", f"MS_OWNER_ID={owner_id}", *[x for k in PASS_ENV for x in ("-e", k)]]
        return ["docker", "run", "--rm", "--name", self.name(owner_id), "--label", "mainstreet=1",
                "--memory", "1g", "--cpus", "1.5", "--pids-limit", "256",
                "-v", f"{work}:/work", "-v", f"{self.s.workspaces / '_decisions' / owner_id}:/decisions:ro",
                "-v", f"{self.s.budget}:/budget", *env, self.s.image,
                "claude", "-p", prompt, "--resume" if resume else "--session-id", session_id,
                "--model", self.s.model, "--output-format", "stream-json", "--verbose",
                "--settings", "/sandbox/settings.json", "--add-dir", "/work",
                "--allowedTools", ALLOWED_TOOLS, "--disallowedTools", DISALLOWED_TOOLS]

    def session_files(self, owner_id: str, session_id: str) -> list:
        return list((self.s.workspaces / owner_id / ".claude-config" / "projects").glob(f"*/{session_id}.jsonl"))

    def session_exists(self, owner_id: str, session_id: str) -> bool:
        return bool(self.session_files(owner_id, session_id))

    async def run(self, owner_id: str, prompt: str, session_id: str, resume: bool) -> AsyncIterator[dict]:
        if time.time() < self.token_limited_until and self.has_key():
            async for ev in self._attempt(owner_id, prompt, session_id, use_key=True):
                yield ev
            return
        # A rejected attempt still writes the prompt and the limit message into the session: remember its size.
        before = {p: p.stat().st_size for p in self.session_files(owner_id, session_id)}
        retry, worked = False, False
        attempt = self._attempt(owner_id, prompt, session_id, use_key=False)
        try:
            async for ev in attempt:
                until = rejected_until(ev)
                if until is not None:
                    self.token_limited_until = until
                    # Retry only if the agent has not run anything yet; a retry could repeat paid tool calls.
                    if not worked and self.has_key():
                        retry = True
                        break
                worked = worked or ev.get("type") in ("assistant", "user")
                yield ev
        finally:
            await attempt.aclose()  # stops the container now, not at garbage collection
        if not retry:
            return
        for p in self.session_files(owner_id, session_id):
            if p in before:
                with p.open("r+b") as f:
                    f.truncate(before[p])
            else:
                p.unlink()
        async for ev in self._attempt(owner_id, prompt, session_id, use_key=True):
            yield ev

    async def _rm(self, owner_id: str) -> None:
        p = await asyncio.create_subprocess_exec("docker", "rm", "-f", self.name(owner_id),
                                                 stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
        await p.wait()

    async def _attempt(self, owner_id: str, prompt: str, session_id: str, use_key: bool) -> AsyncIterator[dict]:
        self.s.budget.mkdir(parents=True, exist_ok=True)
        (self.s.workspaces / "_decisions" / owner_id).mkdir(parents=True, exist_ok=True)
        # What is on disk wins over our flag: a turn that died early may or may not have created the session.
        resume = self.session_exists(owner_id, session_id)
        await self._rm(owner_id)  # the per-owner lock means any container with this name is a leftover
        proc = await asyncio.create_subprocess_exec(
            *self.command(owner_id, prompt, session_id, resume, use_key), env=self.env(),
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, limit=16 * 1024 * 1024)
        err = asyncio.create_task(proc.stderr.read())
        deadline = time.monotonic() + self.s.turn_timeout
        try:
            while True:
                left = deadline - time.monotonic()
                if left <= 0:
                    raise TimeoutError
                line = await asyncio.wait_for(proc.stdout.readline(), left)
                if not line:
                    break
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    continue
            code = await proc.wait()
            if code:
                tail = (await err).decode(errors="replace")[-1500:]
                yield {"type": "runner_error", "message": f"exit {code}: {tail}"}
        except TimeoutError:
            yield {"type": "runner_error", "message": "turn timed out"}
        finally:
            if proc.returncode is None:
                await self._rm(owner_id)
                with contextlib.suppress(ProcessLookupError):  # `docker run` often exits during the rm
                    proc.kill()
            err.cancel()


class FakeRunner:
    """Plays back canned stream-json events. Used by tests and by `MS_RUNNER=fake` for web work without Docker."""

    def __init__(self, events: list[dict], delay: float = 0.0):
        self.events, self.delay = events, delay
        self.calls: list[dict] = []
        self.active = self.max_active = 0
        self.active_per_owner: dict[str, int] = defaultdict(int)
        self.max_active_per_owner: dict[str, int] = defaultdict(int)

    async def run(self, owner_id: str, prompt: str, session_id: str, resume: bool) -> AsyncIterator[dict]:
        self.calls.append({"owner_id": owner_id, "prompt": prompt, "session_id": session_id, "resume": resume})
        self.active += 1
        self.active_per_owner[owner_id] += 1
        self.max_active = max(self.max_active, self.active)
        self.max_active_per_owner[owner_id] = max(self.max_active_per_owner[owner_id], self.active_per_owner[owner_id])
        try:
            for ev in self.events:
                await asyncio.sleep(self.delay)
                yield ev
        finally:
            self.active -= 1
            self.active_per_owner[owner_id] -= 1
