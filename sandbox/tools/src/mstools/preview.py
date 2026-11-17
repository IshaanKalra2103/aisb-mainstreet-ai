"""preview: a short video of a tool doing its job in the owner's business (OpenRouter video API).

Cached per tool. Live renders are capped per owner, per day and by a global dollar cap.

The "your site" clip: `site-info` reads the shop's homepage in a cloud browser (look, photos, headline) and saves
a screenshot; a subagent rebuilds the page as ONE self-contained /work/tmp/demo/index.html with the tool as one
block between `<!-- tool -->` and `<!-- /tool -->`; `frames` renders it closed and open (html.open); `make --first
--last` turns the two frames into the clip, so every word on screen is exact.
"""
import argparse
import asyncio
import base64
import contextlib
import os
import shutil
import subprocess
import time
from pathlib import Path

import httpx

from . import browseruse, config, opener, ws
from .budget import BudgetExceeded, bump_count, charge, spent
from .cli import ToolError, log, run
from .player import PLAYER_JS

API = "https://openrouter.ai/api/v1/videos"


def http_client() -> httpx.Client:
    return httpx.Client(timeout=60)


def _headers() -> dict:
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        raise ToolError("OPENROUTER_API_KEY is not set.")
    return {"Authorization": f"Bearer {key}"}


def _record(tool: str, prompt: str, status: str, video_file: str | None = None, cost: float = 0.0,
            kind: str = "plain") -> dict:
    data = {"tool_id": tool, "prompt": prompt, "status": status, "video_file": video_file, "cost_usd": round(cost, 4),
            "kind": kind}
    ws.save("preview", data)
    return data


def _data_url(path: str) -> str:
    f = Path(path)
    if not f.is_file():
        raise ToolError(f"No frame at {path}. Run `preview frames --html /work/tmp/demo/index.html` first.")
    mime = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}.get(f.suffix.lower(), "image/png")
    return f"data:{mime};base64," + base64.b64encode(f.read_bytes()).decode()


def make(tool: str, prompt: str, seconds: int, first: str | None = None, last: str | None = None) -> dict:
    ws.check_id(tool)  # it names the .mp4 and the record: check before any spend or file write
    work = config.work()
    kind = "site" if first and last else "plain"
    frames = [{"type": "image_url", "image_url": {"url": _data_url(first)}, "frame_type": "first_frame"},
              {"type": "image_url", "image_url": {"url": _data_url(last)}, "frame_type": "last_frame"}] \
        if kind == "site" else None
    if frames:
        seconds = config.PREVIEW_MAX_SECONDS
    seconds = max(config.PREVIEW_MIN_SECONDS, min(config.PREVIEW_MAX_SECONDS, seconds))
    allowed = [d for d in config.VIDEO_DURATIONS if d <= seconds] or [min(config.VIDEO_DURATIONS)]
    seconds = max(allowed)
    mp4 = work / f"preview_{tool}.mp4"
    existing = ws.load("preview", tool)
    if existing and existing.get("status") == "completed" and mp4.exists() and existing.get("kind", "plain") == kind:
        return {"preview": existing, "cached": True}
    estimate = seconds * config.video_usd_per_sec()
    gl, cap = config.global_budget(), config.CAPS["video_global"]
    try:
        if spent(gl, "video_global") + estimate > cap:
            raise BudgetExceeded("The preview budget for this demo is used up.")
        bump_count(config.owner_budget(), "previews", config.PREVIEWS_PER_OWNER)
        bump_count(gl, "previews", config.PREVIEWS_PER_DAY, per_day=True)
    except BudgetExceeded as e:
        return {"preview": _record(tool, prompt, "capped", kind=kind), "cached": False, "message": str(e)}

    body = {"model": config.video_model(), "prompt": prompt, "duration": seconds, "resolution": "720p",
            "aspect_ratio": "16:9", "generate_audio": False}
    if frames:
        body["frame_images"] = frames
    poll = float(os.environ.get("MS_VIDEO_POLL_SECONDS", "15"))
    with http_client() as h:
        r = h.post(API, json=body, headers=_headers())
        if r.status_code >= 400:
            log(f"submit failed {r.status_code}: {r.text[:300]}")
            return {"preview": _record(tool, prompt, "failed", kind=kind), "cached": False,
                    "message": "The video service refused the request."}
        job = r.json()
        url = job.get("polling_url") or f"{API}/{job['id']}"
        deadline = time.time() + 600
        while True:
            st = h.get(url, headers=_headers()).json()
            status = st.get("status")
            if status == "completed":
                break
            if status in ("failed", "cancelled", "expired") or time.time() > deadline:
                log(f"video job {job.get('id')} ended {status}: {st.get('error')}")
                return {"preview": _record(tool, prompt, "failed", kind=kind), "cached": False,
                        "message": "The preview could not be made."}
            log(f"video job {job.get('id')}: {status}")
            time.sleep(poll)
        video_url = (st.get("unsigned_urls") or [None])[0]
        if not video_url:
            return {"preview": _record(tool, prompt, "failed", kind=kind), "cached": False, "message": "No video came back."}
        dl = h.get(video_url, headers=_headers(), follow_redirects=True)
        dl.raise_for_status()
        mp4.write_bytes(dl.content)
    cost = float((st.get("usage") or {}).get("cost") or estimate)
    charge(gl, "video_global", cost, float("inf"))  # record what was actually spent
    return {"preview": _record(tool, prompt, "completed", mp4.name, cost, kind), "cached": False}


SITE_JS = r"""() => {
  const abs = u => { try { return new URL(u, location.href).href } catch { return null } };
  const cs = e => e ? getComputedStyle(e) : null;
  const solid = c => c && !/rgba\(\s*0,\s*0,\s*0,\s*0\)|transparent/.test(c);
  const body = document.body, h1 = document.querySelector('h1');
  const btn = [...document.querySelectorAll('a[class*=btn],button,a[class*=button],.button')]
    .find(e => solid(cs(e).backgroundColor) && e.offsetWidth > 40);
  let bg = cs(body).backgroundColor;
  if (!solid(bg)) bg = cs(document.documentElement).backgroundColor;
  const logo = [...document.querySelectorAll('header img, nav img, img')]
    .find(i => /logo/i.test(i.src + ' ' + i.alt + ' ' + i.className) && i.naturalWidth > 0);
  const photos = [...document.images].filter(i => i.naturalWidth >= 500 && i !== logo)
    .sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight)
    .map(i => abs(i.currentSrc || i.src)).filter(Boolean);
  const bgs = [...document.querySelectorAll('section, header, div')].slice(0, 400)
    .map(e => (cs(e).backgroundImage.match(/url\(["']?([^"')]+)/) || [])[1]).filter(Boolean).map(abs);
  const nav = [...document.querySelectorAll('header a, nav a')].map(a => a.innerText.trim())
    .filter(t => t && t.length < 24);
  return {
    title: document.title,
    headline: (h1 ? h1.innerText : '').trim().slice(0, 140),
    colors: {background: bg, text: cs(body).color, accent: btn ? cs(btn).backgroundColor : cs(h1 || body).color},
    fonts: {body: cs(body).fontFamily, heading: cs(h1 || body).fontFamily},
    logo: logo ? abs(logo.currentSrc || logo.src) : null,
    photos: [...new Set([...photos, ...bgs])].slice(0, 6),
    nav: [...new Set(nav)].slice(0, 8),
  };
}"""


async def _site_info(url: str, shot: Path) -> dict:
    async with browseruse.browser(proxy=None, width=1280, height=1080, minutes=3) as (page, _s):
        await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
        try:
            await page.wait_for_load_state("networkidle", timeout=8_000)
        except Exception:
            pass  # chat widgets and trackers keep the network busy; the page is there
        info = await page.evaluate(SITE_JS)
        shot.parent.mkdir(parents=True, exist_ok=True)
        await page.screenshot(path=str(shot), clip=FRAME)  # the same 1280x720 frame the rebuild is drawn for
        info["final_url"] = page.url
        return info


def site_info(url: str) -> dict:
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    shot = config.work() / "tmp" / "demo" / "real.png"
    try:
        info = asyncio.run(asyncio.wait_for(_site_info(url, shot), timeout=75))
    except Exception as e:
        log(f"site-info failed: {type(e).__name__}: {str(e)[:200]}")
        raise ToolError("Could not open the website, so make the plain preview instead (preview make without frames).")
    return {**info, "screenshot": str(shot)}


TOOL_OPEN, TOOL_CLOSE = "<!-- tool -->", "<!-- /tool -->"


FRAME = {"x": 0, "y": 0, "width": 1280, "height": 720}
# Pins the page to one 1280x720 frame whatever the window is: a transform on body makes body the containing block
# of position:fixed, so the tool block sits where it would on a 1280x720 screen.
FRAME_CSS = ("<style>html,body{margin:0;width:1280px;height:720px;overflow:hidden}"
             "body{position:relative;transform:translateZ(0)}</style>")


def _pinned(html: str) -> str:
    i = html.lower().find("</head>")
    return html[:i] + FRAME_CSS + html[i:] if i >= 0 else FRAME_CSS + html


async def _frames(html: str, first: Path, last: Path) -> None:
    # Measured on Browser Use: set_content never sees "load" (a data: URL loads in 0.1 s); viewport emulation is
    # ignored (a 1280x720 screen gives a 1280x474 page under the toolbar, a 1280x1080 screen gives 1280x824) and
    # the pixel ratio changes per browser (2, 1.25). So: a tall screen, the page pinned to 1280x720, a clipped shot.
    async with browseruse.browser(proxy=None, width=1280, height=1080, minutes=3) as (page, _s):
        url = "data:text/html;base64," + base64.b64encode(_pinned(html).encode()).decode()
        await page.goto(url, wait_until="load", timeout=30_000)
        await page.wait_for_timeout(600)
        await page.screenshot(path=str(first), clip=FRAME, type="jpeg", quality=90)
        await page.evaluate("() => document.documentElement.classList.add('open')")
        await page.wait_for_timeout(800)
        await page.screenshot(path=str(last), clip=FRAME, type="jpeg", quality=90)


def frames(html_path: str) -> dict:
    f = Path(html_path)
    if not f.is_file():
        raise ToolError(f"No page at {html_path}. Write the rebuild as one file, /work/tmp/demo/index.html, first.")
    html = f.read_text()
    if TOOL_OPEN not in html or TOOL_CLOSE not in html:
        raise ToolError(f"index.html needs the tool as one block between {TOOL_OPEN} and {TOOL_CLOSE} "
                        "(at the end of body), shown in use when html has the class 'open'.")
    work = config.work()
    first, last = work / "demo_first.jpg", work / "demo_last.jpg"  # the browser shoots at 2x: JPEG keeps them small
    try:
        asyncio.run(asyncio.wait_for(_frames(html, first, last), timeout=90))
    except Exception as e:
        log(f"frames failed: {type(e).__name__}: {str(e)[:200]}")
        raise ToolError("Could not render the page, so make the plain preview instead (preview make without frames).")
    return {"first": str(first), "last": str(last)}


REC_FPS = 15


def _with_player(html: str) -> str:
    tag = f"<script>{PLAYER_JS}</script>"
    i = html.lower().rfind("</body>")
    return html[:i] + tag + html[i:] if i >= 0 else html + tag


async def _record_run(html: str, frames_dir: Path) -> None:
    async with browseruse.browser(proxy=None, width=1280, height=1080, minutes=5) as (page, _s):
        url = "data:text/html;base64," + base64.b64encode(_with_player(_pinned(html)).encode()).decode()
        await page.goto(url, wait_until="load", timeout=30_000)
        with contextlib.suppress(Exception):
            await page.wait_for_load_state("networkidle", timeout=8_000)  # the shop's photos and fonts
        await page.wait_for_timeout(400)
        total = float(await page.evaluate("() => window.__mt.total"))
        # Each frame is drawn at its exact time by the player, then shot: no dropped frames, whatever the network.
        for i in range(int(total * REC_FPS) + 1):
            await page.evaluate("t => window.__mt.seek(t)", i / REC_FPS)
            await page.screenshot(path=str(frames_dir / f"f{i:04d}.jpg"), clip=FRAME, type="jpeg", quality=85,
                                  scale="css")  # 1280x720 whatever the pixel ratio: a quarter of the bytes at 2x


def _encode(frames_dir: Path, fps: int, out: Path) -> None:
    import imageio_ffmpeg  # a static ffmpeg in a wheel: the sandbox image has no system ffmpeg

    cmd = [imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error", "-framerate", str(fps),
           "-i", str(frames_dir / "f%04d.jpg"), "-vf", "scale=1280:720:flags=lanczos,format=yuv420p",
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-movflags", "+faststart", str(out)]
    subprocess.run(cmd, check=True, capture_output=True, timeout=180)


def record(tool: str, html_path: str, view: str = "site") -> dict:
    """Record the run-through: the cursor opens the tool, the customer types, the tool answers, all in exact words.

    view: "site" for the rebuild of the shop's homepage (site-demo), "shop" for the in-shop view (screen-demo)."""
    f = Path(html_path)
    if not f.is_file():
        raise ToolError(f"No page at {html_path}. Write the rebuild as one file, /work/tmp/demo/index.html, first.")
    html = f.read_text()
    block = html[html.find(TOOL_OPEN):html.find(TOOL_CLOSE)] if TOOL_OPEN in html and TOOL_CLOSE in html else ""
    if "data-step" not in block:
        raise ToolError("The tool block needs its steps marked: data-step=\"1\", \"2\"... with data-act=\"click\", "
                        "\"type\" or \"show\" (see the site-demo rules).")
    work = config.work()
    mp4, tmp = work / f"preview_{tool}.mp4", work / "tmp" / "rec"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    try:
        asyncio.run(asyncio.wait_for(_record_run(html, tmp), timeout=300))
        _encode(tmp, REC_FPS, mp4)
    except Exception as e:
        log(f"record failed: {type(e).__name__}: {str(e)[:200]}")
        raise ToolError("Could not record the run-through, so make the clip from the two frames instead (preview make "
                        "--tool T --prompt P --first /work/demo_first.jpg --last /work/demo_last.jpg).")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    what = ("Recorded run-through of the tool's own screen on a phone in front of the shop" if view == "shop"
            else "Recorded run-through of the tool on a copy of the shop's homepage")
    rec = _record(tool, what, "completed", mp4.name, 0.0, "shop" if view == "shop" else "site")
    return {"preview": rec, "cached": False}


def _main(a: argparse.Namespace) -> dict:
    if (r := opener.handle(a)) is not None:
        return r
    if a.cmd == "record":
        return record(a.tool, a.html, a.view)
    if a.cmd == "site-info":
        return site_info(a.url)
    if a.cmd == "frames":
        return frames(a.html)
    if bool(a.first) != bool(a.last):
        raise ToolError("Give both --first and --last, or neither.")
    return make(a.tool, a.prompt, a.seconds, a.first, a.last)


def main() -> None:
    p = argparse.ArgumentParser(prog="preview", description="Make a short preview video of a tool.")
    sub = p.add_subparsers(dest="cmd", required=True)
    opener.register(sub)
    m = sub.add_parser("make")
    m.add_argument("--tool", required=True)
    m.add_argument("--prompt", required=True)
    m.add_argument("--seconds", type=int, default=6)
    m.add_argument("--first", help="first frame PNG (from `preview frames`): makes the clip from the shop's own site")
    m.add_argument("--last", help="last frame PNG")
    si = sub.add_parser("site-info", help="read the shop's homepage: colors, fonts, logo, photos; saves a screenshot")
    si.add_argument("--url", required=True)
    fr = sub.add_parser("frames", help="render the one-file rebuild closed and open")
    fr.add_argument("--html", default="/work/tmp/demo/index.html")
    rc = sub.add_parser("record", help="record the run-through on the one-file rebuild: cursor, typing, the answer")
    rc.add_argument("--tool", required=True)
    rc.add_argument("--html", default="/work/tmp/demo/index.html")
    rc.add_argument("--view", choices=("site", "shop"), default="site",
                    help="site: a copy of the shop's homepage; shop: the tool's screen in front of the shop (screen-demo)")
    run(_main, p)


if __name__ == "__main__":
    main()
