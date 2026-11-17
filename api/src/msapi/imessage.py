"""iMessage: the relay posts {from_hash, text}; we run a turn and hand back at most 3 texts plus the page link."""
import json
import re
import time
from datetime import date

from .settings import Settings
from .turns import LimitReached, TurnManager
from .workspaces import NotFound, Workspaces, _read, _write

MAX_TEXTS = 3
# Native iMessage poll for a pending approval. The vote decides it the way the page's buttons do.
YES, NO = "Yes, set it up", "Not now"
CLOSED = "That question is already answered. Your page has the latest."


class RateLimited(Exception):
    pass


URL_RE = re.compile(r"https?://[^\s<>()\[\]]+")
MD_LINK_RE = re.compile(r"\[([^\]]+)\]\((https?://[^)\s]+)\)")
# The share page's turn starts with this (web/lib/shop.ts shopTurnText); once seen, the owner has shared.
SHARED_MARK = '"role": "owner", "text": "Here is my shop.'  # workspaces.py writes role, then text


def split_texts(reply: str, link: str) -> tuple[list[str], list[str]]:
    """Plain bubbles (<= MAX_TEXTS) and the URLs pulled out of them (the page link is dropped: the relay sends it as a card)."""
    urls: list[str] = []

    def grab(u: str) -> str:
        u = u.rstrip(".,;:!?")
        if u and u != link and u not in urls:
            urls.append(u)
        return ""

    # drop the page link only where it is the whole URL: "<link>/shop" (the share page) must stay whole
    text = re.sub(re.escape(link) + r"(?![/\w])", "", reply or "") if link else (reply or "")
    text = MD_LINK_RE.sub(lambda m: (grab(m[2]) or "") + m[1], text)
    text = URL_RE.sub(lambda m: grab(m[0]), text)
    text = re.sub(r"\*\*(.+?)\*\*|__(.+?)__", lambda m: m[1] or m[2], text)
    text = re.sub(r"(?m)^[ \t]*(?:#{1,6}[ \t]+|(?:[-*\u2022]|\d{1,2}[.)])[ \t]+)", "", text).replace("`", "")
    text = re.sub(r"(?m)[ \t]*[:\-\u2013]+[ \t]*$", "", text)  # "Maryland SBDC:" left behind by a pulled URL
    text = re.sub(r"[ \t]{2,}", " ", text)
    parts = [p.strip() for p in re.split(r"\n\s*\n", text)]
    parts = [p for p in parts if p]
    if len(parts) > MAX_TEXTS:
        parts = parts[: MAX_TEXTS - 1] + ["\n\n".join(parts[MAX_TEXTS - 1:])]
    return parts or ["Done. Everything is on your page."], urls[:1]


class IMessage:
    def __init__(self, ws: Workspaces, turns: TurnManager, settings: Settings):
        self.ws, self.turns, self.s = ws, turns, settings
        self.min_gap = settings.imessage_min_gap
        self.per_day = settings.imessage_per_day
        self.wait_s = settings.imessage_wait
        self.last: dict[str, float] = {}
        self.counts: dict[tuple[str, str], int] = {}

    def _needs_shop(self, oid: str) -> bool:
        """True until the profile has facts or the owner has used the share page: iMessage then sends the
        "Share your shop" card instead of the page card. A share whose link could not be read leaves no facts,
        and the card must not come back on every reply after that."""
        d = self.ws.owner_dir(oid)
        try:
            if json.loads((d / "profile.json").read_text()).get("facts"):
                return False
        except (OSError, ValueError, AttributeError):
            pass
        try:
            with (d / "messages.jsonl").open() as f:
                return not any(SHARED_MARK in line for line in f)
        except OSError:
            return True

    def _tool_name(self, tool_id: str) -> str:
        """The catalog's name for a tool (the agent's catalog), else its id."""
        try:
            tools = json.loads((self.s.root / "sandbox" / "catalog.json").read_text()).get("tools", [])
            return next((t["name"] for t in tools if t.get("id") == tool_id and t.get("name")), tool_id)
        except (OSError, ValueError, AttributeError, TypeError):
            return tool_id

    def _question(self, ap: dict) -> str:
        return f"Set up {self._tool_name(ap.get('tool_id', ''))} for you?"

    def _pending(self, oid: str) -> list[dict]:
        d = self.ws.owner_dir(oid) / "approvals"
        aps = [a for f in sorted(d.glob("ap_*.json")) if (a := _read(f))] if d.exists() else []
        return sorted((a for a in aps if a.get("status") == "pending"), key=lambda a: a.get("created_at", ""))

    def _offer(self, oid: str) -> dict | None:
        """The oldest pending approval not yet offered here, as a poll. Each approval is offered once."""
        p = self.ws.owner_dir(oid) / ".offered.json"
        offered = set(_read(p) or [])
        ap = next((a for a in self._pending(oid) if a.get("id") not in offered), None)
        if not ap:
            return None
        _write(p, sorted(offered | {ap["id"]}))
        return {"question": self._question(ap), "options": [YES, NO]}

    def _guard(self, from_hash: str) -> None:
        now = time.monotonic()
        if from_hash in self.last and now - self.last[from_hash] < self.min_gap:
            raise RateLimited("Give me a few seconds between texts.")
        key = (from_hash, date.today().isoformat())
        if self.counts.get(key, 0) >= self.per_day:
            raise RateLimited("That's all for today, try again tomorrow.")
        self.last[from_hash] = now
        self.counts[key] = self.counts.get(key, 0) + 1

    async def handle(self, from_hash: str, text: str) -> dict:
        self._guard(from_hash)
        t0 = time.time()
        oid = self.ws.owner_for_phone(from_hash)
        try:
            tid = self.turns.start(oid, text, "imessage")
        except LimitReached as e:  # busy owner, full queue, daily cap: the relay texts the detail back
            raise RateLimited(str(e))
        return await self._reply(oid, tid, t0)

    async def vote(self, from_hash: str, question: str, option: str) -> dict:
        """A vote on our poll. It can only decide a pending approval of the voter's own owner."""
        self._guard(from_hash)
        t0 = time.time()
        oid = self.ws.owner_for_phone(from_hash)
        link = f"{self.s.web_url}/b/{oid}"
        ap = next((a for a in self._pending(oid) if self._question(a) == question), None)
        if not ap:
            return {"replies": [CLOSED], "link": link, "links": [link], "video_url": None, "poll": None}
        decision = "approve" if option == YES else "reject"
        # As in the page's decide route: no await between the checks and the write.
        try:
            self.ws.pending_approval(oid, ap["id"])
            self.turns.check(oid)
            ap = self.ws.decide(oid, ap["id"], decision)
        except (ValueError, NotFound):
            return {"replies": [CLOSED], "link": link, "links": [link], "video_url": None, "poll": None}
        except LimitReached as e:
            raise RateLimited(str(e))
        word = "approved" if decision == "approve" else "rejected"
        shown = f"{'Approved' if word == 'approved' else 'Declined'}: {ap['summary']}"
        try:
            tid = self.turns.start(oid, f"Owner {word} approval {ap['id']}", "imessage", log_text=shown)
        except LimitReached as e:
            raise RateLimited(str(e))
        return await self._reply(oid, tid, t0)

    async def _reply(self, oid: str, tid: str, t0: float) -> dict:
        link = f"{self.s.web_url}/b/{oid}"
        urls: list[str] = []
        ev = await self.turns.wait(tid, self.wait_s)
        if ev is None:
            replies, urls = ["Still working on that. I'll put everything on your page."], []
        elif ev["type"] == "error":
            replies = ["Something went wrong on my side. Try again in a minute."]
        else:
            replies, urls = split_texts(ev["reply"], link)
        # Rich extras for the relay: link cards (page first), the preview video this turn made, and a poll for a
        # pending approval.
        video = None
        if ev and ev["type"] == "done":
            new = [f for f in self.ws.owner_dir(oid).glob("preview_*.mp4") if f.stat().st_mtime >= t0]
            if new:
                video = f"/media/{oid}/{max(new, key=lambda f: f.stat().st_mtime).name}"
        first = f"{link}/shop" if self._needs_shop(oid) else link
        links = list(dict.fromkeys([first, *urls]))  # the agent may paste the share URL too
        return {"replies": replies, "link": link, "links": links, "video_url": video, "poll": self._offer(oid)}
