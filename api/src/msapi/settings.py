"""API settings. Everything that differs between the laptop demo and tests lives here."""
import os
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def _origins() -> list[str]:
    raw = os.environ.get("MS_WEB_ORIGINS", "http://localhost:3000,http://localhost:3101,https://mainstreet-ai-five.vercel.app")
    return [o.strip() for o in raw.split(",") if o.strip()]


@dataclass
class Settings:
    root: Path = ROOT
    workspaces: Path = Path(os.environ.get("MS_WORKSPACES", ROOT / "workspaces"))
    budget: Path = Path(os.environ.get("MS_BUDGET_DIR", ROOT / "budget"))
    web_url: str = os.environ.get("MS_WEB_URL", "https://mainstreet-ai-five.vercel.app")
    web_origins: list[str] = field(default_factory=_origins)
    max_concurrent: int = 2
    image: str = os.environ.get("MS_SANDBOX_IMAGE", "mainstreet-sandbox")
    model: str = os.environ.get("MS_AGENT_MODEL", "claude-sonnet-5-5")
    turn_timeout: float = 1500.0
    relay_secret: str | None = os.environ.get("MS_RELAY_SECRET") or None
    owners_per_day: int = 120
    owners_per_ip_day: int = 6  # keyed on CF-Connecting-IP (the tunnel), else the socket peer
    turns_per_owner_day: int = 40
    max_waiting: int = 6  # turns queued for the semaphore; beyond this, new turns get a 429
    health_ttl: float = 20.0
    imessage_min_gap: float = 5.0
    imessage_per_day: int = 40
    imessage_wait: float = 280.0
    # The website's "Text me" (POST /api/phone): Photon dashboard session + project, a hard cap on numbers the form
    # adds (the free plan allows 10 in all, one is Ishaan's), and adds per client per day (venue Wi-Fi is one IP).
    photon_session: str | None = os.environ.get("PHOTON_SESSION") or None
    photon_project_id: str | None = os.environ.get("PHOTON_PROJECT_ID") or None
    phone_adds_cap: int = int(os.environ.get("MS_PHONE_ADDS_CAP", "9"))
    phone_adds_per_ip_day: int = int(os.environ.get("MS_PHONE_ADDS_PER_IP_DAY", "3"))
    phone_tries_per_ip_day: int = 8
