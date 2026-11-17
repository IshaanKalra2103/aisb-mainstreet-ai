"""iMessage: the relay posts {from_hash, text}; we run a turn and hand back at most 3 texts plus the page link."""
import json
import logging
import re
import secrets
import time
from datetime import date

from .settings import Settings
from .turns import LimitReached, Turn, TurnManager
from .workspaces import NotFound, Workspaces, _read, _write

log = logging.getLogger("msapi.imessage")
# Texting first: entries the relay picks up with GET /api/imessage/outbox. Kept in memory for OUTBOX_TTL seconds.
OUTBOX_TTL = 900.0
OUTBOX_MAX = 200

MAX_TEXTS = 3
# Native iMessage poll for a pending approval. The vote decides it the way the page's buttons do.
YES, NO = "Yes, set it up", "Not now"
CLOSED = "That question is already answered. Your page has the latest."
# The answer to "Not now", on the page and in iMessage. No agent turn: nothing happens until a yes.
NOT_NOW = "No problem, nothing gets set up. If you change your mind, tap Yes, set it up."


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
        # Outbox for texts the relay sends without an inbound text. The epoch changes on every API start, so a
        # relay holding a cursor from before (VM stop, deploy) reads everything in the new outbox.
        self.outbox: list[dict] = []
        self.seq = 0
        self.epoch = secrets.token_hex(4)
        self.follow: set[str] = set()  # iMessage turns that outlived the relay's wait: push their result
        turns.listeners.append(self._turn_finished)

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
        # A shop code (or page link) from the website: this phone joins that shop. Answered at once, no turn.
        shop = self.ws.owner_in_text(text)
        if shop and from_hash not in self.ws.phones_for_owner(shop):
            return self._join(from_hash, shop, text)
        oid = self.ws.owner_for_phone(from_hash)
        try:
            tid = self.turns.start(oid, text, "imessage")
        except LimitReached as e:  # busy owner, full queue, daily cap: the relay texts the detail back
            raise RateLimited(str(e))
        return await self._reply(oid, tid, t0)

    def _join(self, from_hash: str, oid: str, text: str) -> dict:
        """Tie this phone to a shop started on the website, and say so with the shop's card (and its open question)."""
        self.ws.link_phone(from_hash, oid)
        self.ws.add_message(oid, "owner", text, "imessage")
        name = (_read(self.ws.owner_dir(oid) / "profile.json") or {}).get("name")
        who = f"you're texting as {name} now" if name else "this phone is tied to your shop now"
        reply = f"Got it, {who}. Same plan as on the website, and you can ask me anything here."
        self.ws.add_message(oid, "agent", reply, "imessage")
        link = f"{self.s.web_url}/b/{oid}"
        return {"replies": [reply], "link": link, "links": [link], "video_url": None, "poll": self._offer(oid)}

    def _voted(self, oid: str, question: str, decision: str) -> dict | None:
        """The approval a vote is about: the pending one with this question; for a yes, else the latest one the
        owner said not now to (they changed their mind), unless that tool already has a yes."""
        d = self.ws.owner_dir(oid) / "approvals"
        aps = [a for f in sorted(d.glob("ap_*.json")) if (a := _read(f))] if d.exists() else []
        same = sorted((a for a in aps if self._question(a) == question), key=lambda a: a.get("created_at", ""))
        pending = [a for a in same if a.get("status") == "pending"]
        if pending:
            return pending[0]
        if decision != "approve" or any(a.get("status") == "approved" for a in same):
            return None
        declined = [a for a in same if a.get("status") == "rejected"]
        return declined[-1] if declined else None

    async def vote(self, from_hash: str, question: str, option: str) -> dict:
        """A vote on our poll. It can only decide an approval of the voter's own owner. "Not now" answers at once
        with no turn; a later "Yes" on the same poll still counts."""
        self._guard(from_hash)
        t0 = time.time()
        oid = self.ws.owner_for_phone(from_hash)
        link = f"{self.s.web_url}/b/{oid}"
        closed = {"replies": [CLOSED], "link": link, "links": [link], "video_url": None, "poll": None}
        decision = "approve" if option == YES else "reject"
        ap = self._voted(oid, question, decision)
        if not ap:
            return closed
        # As in the page's decide route: no await between the checks and the write.
        try:
            self.ws.pending_approval(oid, ap["id"], decision)
            if decision == "approve":
                self.turns.check(oid)
            ap = self.ws.decide(oid, ap["id"], decision)
        except (ValueError, NotFound):
            return closed
        except LimitReached as e:
            raise RateLimited(str(e))
        if decision == "reject":
            self.ws.add_message(oid, "owner", f"Declined: {ap['summary']}", "imessage")
            self.ws.add_message(oid, "agent", NOT_NOW, "imessage")
            return {"replies": [NOT_NOW], "link": link, "links": [], "video_url": None, "poll": None}
        try:
            tid = self.turns.start(oid, f"Owner approved approval {ap['id']}", "imessage", log_text=f"Approved: {ap['summary']}")
        except LimitReached as e:
            raise RateLimited(str(e))
        return await self._reply(oid, tid, t0)

    async def _reply(self, oid: str, tid: str, t0: float) -> dict:
        ev = await self.turns.wait(tid, self.wait_s)
        if ev is None:
            turn = self.turns.get(tid)
            if turn.done and turn.events:  # it ended just as the wait ran out
                ev = turn.events[-1]
            else:
                self.follow.add(tid)  # no await since the check: its listener has not run yet
        return self._payload(oid, ev, t0)

    def _payload(self, oid: str, ev: dict | None, t0: float, shop: bool = True) -> dict:
        """What the relay sends for a turn's final event (None: still running). `shop` False for pushes: they
        never carry the share page, whose card would ask the owner for their location out of nowhere."""
        link = f"{self.s.web_url}/b/{oid}"
        urls: list[str] = []
        if ev is None:
            replies = ["Still working on that. I'll text you when it's done."]
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
        if shop:
            first = f"{link}/shop" if self._needs_shop(oid) else link
            links = list(dict.fromkeys([first, *urls]))  # the agent may paste the share URL too
        else:
            links = list(dict.fromkeys([link, *(u for u in urls if u != f"{link}/shop")]))
        return {"replies": replies, "link": link, "links": links, "video_url": video, "poll": self._offer(oid)}

    # Texting first. The relay polls the outbox and sends each entry into the thread of the phone it names.
    def push(self, oid: str, payload: dict) -> int:
        """Queue `payload` for every phone that texts as this owner. Returns how many entries were queued."""
        hashes = self.ws.phones_for_owner(oid)
        now = time.time()
        for h in hashes:
            self.seq += 1
            self.outbox.append({"id": self.seq, "at": now, "from_hash": h, "replies": payload.get("replies") or [],
                                "links": payload.get("links") or [], "video_url": payload.get("video_url"),
                                "poll": payload.get("poll")})
        self._trim(now)
        if hashes:
            log.info("push %s entries=%d", oid, len(hashes))
        return len(hashes)

    def _trim(self, now: float) -> None:
        self.outbox = [e for e in self.outbox if now - e["at"] < OUTBOX_TTL][-OUTBOX_MAX:]

    def read_outbox(self, after: int | None, epoch: str | None) -> dict:
        """Entries after the relay's cursor. Without one (relay start, or polling again after a quiet spell) only
        the cursor comes back, so nothing old is replayed. `busy`: a texting owner has a turn running."""
        self._trim(time.time())
        if after is None:
            entries = []
        elif epoch != self.epoch:  # the API restarted since the relay's cursor: all of this outbox is new to it
            entries = self.outbox
        else:
            entries = [e for e in self.outbox if e["id"] > after]
        busy = any(self.turns.active_turn(o) for o in self.ws.phone_owners())
        return {"epoch": self.epoch, "next": self.seq, "busy": busy,
                "entries": [{k: v for k, v in e.items() if k != "at"} for e in entries]}

    def _turn_finished(self, turn: Turn, ev: dict) -> None:
        """A website turn of a texting owner, or an iMessage turn the relay stopped waiting for: text its result.
        Other iMessage turns are answered by the relay's own call (pushing them too would double every text)."""
        followed = turn.id in self.follow
        self.follow.discard(turn.id)
        # Phones first: _payload marks a pending approval as offered, which must not happen for a web-only owner.
        if (turn.channel == "web" or followed) and self.ws.phones_for_owner(turn.owner_id):
            self.push(turn.owner_id, self._payload(turn.owner_id, ev, turn.created, shop=False))

    def web_decided(self, oid: str, ap: dict, decision: str, reply: str | None = None) -> None:
        """The website's yes or no on an approval. A yes is texted at once, so the phone hears it before the setup
        turn ends (that turn's result follows through _turn_finished). `reply` is a fixed answer for a decision
        that starts no turn. Never raises: the page's decision must not fail over a text."""
        try:
            if decision == "approve":
                text = (f"Got your yes on the website. Setting up {self._tool_name(ap.get('tool_id', ''))} now. "
                        "I'll text you when it's done, or if I need you for a step.")
            elif reply:
                text = reply
            else:
                return
            self.push(oid, {"replies": [text], "links": [], "video_url": None, "poll": None})
        except Exception:
            log.exception("web_decided push failed")
