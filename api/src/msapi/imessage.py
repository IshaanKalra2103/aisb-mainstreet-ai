"""iMessage: the relay posts {from_hash, text}; we run a turn and hand back at most 3 texts plus the page link."""
import json
import re
import time
from datetime import date

from .settings import Settings
from .turns import LimitReached, TurnManager
from .workspaces import Workspaces

MAX_TEXTS = 3


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
    text = re.sub(r"(?m)^[ \t]*(?:#{1,6}[ \t]+|[-*\u2022][ \t]+)", "", text).replace("`", "")
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

    async def handle(self, from_hash: str, text: str) -> dict:
        now = time.monotonic()
        if from_hash in self.last and now - self.last[from_hash] < self.min_gap:
            raise RateLimited("Give me a few seconds between texts.")
        key = (from_hash, date.today().isoformat())
        if self.counts.get(key, 0) >= self.per_day:
            raise RateLimited("That's all for today, try again tomorrow.")
        self.last[from_hash] = now
        t0 = time.time()
        self.counts[key] = self.counts.get(key, 0) + 1
        oid = self.ws.owner_for_phone(from_hash)
        link = f"{self.s.web_url}/b/{oid}"
        try:
            tid = self.turns.start(oid, text, "imessage")
        except LimitReached as e:  # busy owner, full queue, daily cap: the relay texts the detail back
            raise RateLimited(str(e))
        urls: list[str] = []
        ev = await self.turns.wait(tid, self.wait_s)
        if ev is None:
            replies, urls = ["Still working on that. I'll put everything on your page."], []
        elif ev["type"] == "error":
            replies = ["Something went wrong on my side. Try again in a minute."]
        else:
            replies, urls = split_texts(ev["reply"], link)
        # Rich extras for the relay: link cards (page first) and the preview video this turn made, if any.
        video = None
        if ev and ev["type"] == "done":
            new = [f for f in self.ws.owner_dir(oid).glob("preview_*.mp4") if f.stat().st_mtime >= t0]
            if new:
                video = f"/media/{oid}/{max(new, key=lambda f: f.stat().st_mtime).name}"
        first = f"{link}/shop" if self._needs_shop(oid) else link
        links = list(dict.fromkeys([first, *urls]))  # the agent may paste the share URL too
        return {"replies": replies, "link": link, "links": links, "video_url": video}
