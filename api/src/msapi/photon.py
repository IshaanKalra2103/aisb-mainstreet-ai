"""Adds a phone number to the Photon line's allowed list (its Spectrum users), so the line may text that number.

On the free plan the line only texts numbers on this list (10 at most). The calls are the dashboard's own
(see ~/Documents/projects/agents/photonctl): auth is a dashboard session cookie (PHOTON_SESSION), which is a
whole-account login, so this module only ever lists users, checks a number, and adds a shared user.
Nothing here logs a number, a name or an email.
"""
import asyncio
import json
import logging
import urllib.error
import urllib.parse
import urllib.request

log = logging.getLogger("msapi.photon")

COOKIE = "__Secure-better-auth.session_token"
PLAN_LIMIT = 10  # Spectrum users on the free plan


class PhotonError(Exception):
    """`kind`: "off" (no session), "full" (the allowed list is full), "unavailable" (Photon won't take that
    number), "auth" (the session ran out), "down" (anything else)."""

    def __init__(self, kind: str, msg: str = ""):
        super().__init__(msg or kind)
        self.kind = kind


class Photon:
    def __init__(self, session: str | None, project_id: str | None = None, base: str = "https://app.photon.codes",
                 timeout: float = 20.0):
        self.session, self.project_id, self.base, self.timeout = session, project_id, base.rstrip("/"), timeout

    @property
    def on(self) -> bool:
        return bool(self.session)

    def _call(self, method: str, path: str, body: dict | None = None, query: dict | None = None):
        if not self.session:
            raise PhotonError("off")
        url = f"{self.base}/api/{path}" + (f"?{urllib.parse.urlencode(query)}" if query else "")
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method, headers={
            "Cookie": f"{COOKIE}={self.session}", "Accept": "application/json", "Origin": self.base,
            "Referer": f"{self.base}/dashboard", "User-Agent": "Mozilla/5.0 (Macintosh) msapi/0.1",
            **({"Content-Type": "application/json"} if data is not None else {})})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                txt = r.read().decode()
        except urllib.error.HTTPError as e:
            log.warning("photon %s %s answered %s", method, path.split("?")[0].split("/")[-1], e.code)
            raise PhotonError("auth" if e.code in (401, 403) else "down", f"HTTP {e.code}") from None
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            log.warning("photon %s unreachable: %s", method, type(e).__name__)
            raise PhotonError("down", type(e).__name__) from None
        return json.loads(txt) if txt else None

    def _project(self) -> str:
        if not self.project_id:
            r = self._call("GET", "projects")
            ps = r.get("projects", r) if isinstance(r, dict) else r
            if not isinstance(ps, list) or len(ps) != 1:
                raise PhotonError("down", "expected exactly one Photon project; set PHOTON_PROJECT_ID")
            self.project_id = ps[0]["id"]
        return self.project_id

    def _users(self) -> list[dict]:
        rows: list[dict] = []
        while True:
            r = self._call("GET", f"projects/{self._project()}/spectrum/users", query={"limit": 100, "offset": len(rows)})
            batch = (r.get("users") if isinstance(r, dict) else r) or []
            rows += batch
            if not batch or len(rows) >= (r.get("total", 0) if isinstance(r, dict) else 0):
                return rows

    def _allow(self, e164: str, first: str, last: str, email: str) -> bool:
        users = self._users()
        if any(u.get("phoneNumber") == e164 for u in users):
            return False
        if len(users) >= PLAN_LIMIT:
            raise PhotonError("full")
        avail = self._call("GET", "projects/check-availability", query={"phoneNumber": e164}) or {}
        if avail.get("available") is False:
            raise PhotonError("unavailable")
        # sendInvite off: the line texts them itself (the relay opens the thread), not a Photon invite.
        self._call("POST", f"projects/{self._project()}/spectrum/users",
                   {"type": "shared", "firstName": first, "lastName": last, "email": email, "phoneNumber": e164,
                    "sendInvite": False})
        return True

    async def allow(self, e164: str, first: str, last: str, email: str) -> bool:
        """Put `e164` on the allowed list. True if it was added, False if it was already there."""
        return await asyncio.to_thread(self._allow, e164, first, last, email)
