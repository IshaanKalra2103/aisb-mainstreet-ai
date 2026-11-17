"""opener: a 4 s Veo clip that brings the shop's own photo to life, joined in front of the screen recording.

`opener --tool T --photo <url|path> --prompt P` writes /work/opener_T.mp4 (first frame only, no audio).
`join --tool T` puts it in front of /work/preview_T.mp4 with a 0.3 s crossfade.
"""
import argparse
import base64
import json
import mimetypes
import os
import shutil
import subprocess
import time
from pathlib import Path

import httpx

from . import config, ws
from .budget import BudgetExceeded, bump_count, charge, spent
from .cli import ToolError, log

API = "https://openrouter.ai/api/v1/videos"
FADE = 0.3


def http_client() -> httpx.Client:
    return httpx.Client(timeout=60)


def _headers() -> dict:
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        raise ToolError("OPENROUTER_API_KEY is not set.")
    return {"Authorization": f"Bearer {key}"}


def _frame_url(photo: str) -> str:
    if photo.startswith(("http://", "https://")):
        return photo
    f = Path(photo)
    if not f.is_file():
        raise ToolError(f"No photo at {photo}.")
    mime = mimetypes.guess_type(f.name)[0] or "image/jpeg"
    return f"data:{mime};base64," + base64.b64encode(f.read_bytes()).decode()


def _side(tool: str) -> Path:
    return config.work() / f"opener_{tool}.json"


def make_opener(tool: str, photo: str, prompt: str, seconds: int = 4) -> dict:
    ws.check_id(tool)
    work = config.work()
    mp4, side = work / f"opener_{tool}.mp4", _side(tool)
    if mp4.exists() and side.exists() and json.loads(side.read_text()).get("photo") == photo:
        return {"opener": mp4.name, "cached": True}
    frame = _frame_url(photo)
    seconds = max([d for d in config.VIDEO_DURATIONS if d <= seconds] or [min(config.VIDEO_DURATIONS)])
    estimate = seconds * config.video_usd_per_sec()
    gl, cap = config.global_budget(), config.CAPS["video_global"]
    try:
        if spent(gl, "video_global") + estimate > cap:
            raise BudgetExceeded("The preview budget for this demo is used up.")
        bump_count(config.owner_budget(), "previews", config.PREVIEWS_PER_OWNER)
        bump_count(gl, "previews", config.PREVIEWS_PER_DAY, per_day=True)
    except BudgetExceeded as e:
        return {"opener": None, "cached": False, "message": str(e)}
    body = {"model": config.video_model(), "prompt": prompt, "duration": seconds, "resolution": "720p",
            "aspect_ratio": "16:9", "generate_audio": False,
            "frame_images": [{"type": "image_url", "image_url": {"url": frame}, "frame_type": "first_frame"}]}
    poll = float(os.environ.get("MS_VIDEO_POLL_SECONDS", "15"))
    with http_client() as h:
        r = h.post(API, json=body, headers=_headers())
        if r.status_code >= 400:
            log(f"submit failed {r.status_code}: {r.text[:300]}")
            return {"opener": None, "cached": False, "message": "The video service refused the request."}
        job = r.json()
        url = job.get("polling_url") or f"{API}/{job['id']}"
        deadline = time.time() + 600
        while True:
            st = h.get(url, headers=_headers()).json()
            status = st.get("status")
            if status == "completed":
                break
            if status in ("failed", "cancelled", "expired") or time.time() > deadline:
                log(f"opener job {job.get('id')} ended {status}: {st.get('error')}")
                return {"opener": None, "cached": False, "message": "The opener could not be made."}
            time.sleep(poll)
        video_url = (st.get("unsigned_urls") or [None])[0]
        if not video_url:
            return {"opener": None, "cached": False, "message": "No video came back."}
        dl = h.get(video_url, headers=_headers(), follow_redirects=True)
        dl.raise_for_status()
        mp4.write_bytes(dl.content)
    cost = float((st.get("usage") or {}).get("cost") or estimate)
    charge(gl, "video_global", cost, float("inf"))
    side.write_text(json.dumps({"photo": photo, "prompt": prompt, "cost_usd": cost, "joined": False}))
    return {"opener": mp4.name, "cached": False, "cost_usd": round(cost, 4)}


def _ffmpeg() -> str:
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def _duration(path: Path) -> float:
    import re
    r = subprocess.run([_ffmpeg(), "-i", str(path)], capture_output=True, text=True)
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", r.stderr)
    if not m:
        raise ToolError(f"Could not read {path.name}.")
    return int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3])


def _content_crop(path: Path) -> str:
    """Veo pads a 3:2 photo with black side bars; find the picture so the join can crop them off."""
    import re
    r = subprocess.run([_ffmpeg(), "-i", str(path), "-vf", "cropdetect=limit=24:round=2", "-f", "null", "-"],
                       capture_output=True, text=True)
    found = re.findall(r"crop=(\d+):(\d+):(\d+):(\d+)", r.stderr)
    if not found:
        return ""
    w, h, x, y = (int(v) for v in found[-1])
    return f"crop={w}:{h}:{x}:{y}," if w >= 640 and h >= 360 else ""


def join(tool: str, screen: str | None = None, out: str | None = None) -> dict:
    """Opener in front of the recording. Without --screen/--out it replaces /work/preview_T.mp4 (the recording is
    kept as preview_T.screen.mp4 so a second join never stacks openers)."""
    ws.check_id(tool)
    work = config.work()
    op = work / f"opener_{tool}.mp4"
    if not op.exists():
        raise ToolError(f"No opener for {tool}. Run `preview opener --tool {tool} --photo ... --prompt ...` first.")
    preview = work / f"preview_{tool}.mp4"
    keep = work / f"preview_{tool}.screen.mp4"
    if screen:
        rec = Path(screen)
    else:
        if not keep.exists():
            if not preview.exists():
                raise ToolError(f"No recording at {preview.name}. Run `preview record` first.")
            shutil.copyfile(preview, keep)
        rec = keep
    if not rec.exists():
        raise ToolError(f"No recording at {rec}.")
    dest = Path(out) if out else preview
    tmp = dest.with_name(dest.stem + ".joining.mp4")
    offset = _duration(op) - FADE
    norm = "scale=1280:720:force_original_aspect_ratio=increase:flags=lanczos,crop=1280:720,setsar=1,fps=24,format=yuv420p"
    graph = (f"[0:v]{_content_crop(op)}{norm}[a];[1:v]{norm}[b];[a][b]xfade=transition=fade:duration={FADE}:offset={offset:.3f},"
             "format=yuv420p[v]")
    cmd = [_ffmpeg(), "-y", "-loglevel", "error", "-i", str(op), "-i", str(rec), "-filter_complex", graph,
           "-map", "[v]", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-movflags", "+faststart",
           str(tmp)]
    try:
        subprocess.run(cmd, check=True, capture_output=True, timeout=300)
    except subprocess.CalledProcessError as e:
        tmp.unlink(missing_ok=True)
        log(f"join failed: {e.stderr.decode()[-300:]}")
        raise ToolError("Could not join the opener to the recording; ship the recording alone.")
    tmp.replace(dest)
    result = {"joined": str(dest), "seconds": round(_duration(dest), 2)}
    if not out and not screen:
        rec_data = ws.load("preview", tool) or {"tool_id": tool, "prompt": "", "status": "completed",
                                                "video_file": preview.name, "cost_usd": 0.0, "kind": "shop"}
        if "opener" not in rec_data["prompt"]:
            rec_data["prompt"] = (rec_data["prompt"] + " (with a Veo opener of the shop's own photo)").strip()
        rec_data["status"], rec_data["video_file"] = "completed", preview.name
        rec_data["kind"] = "shop"  # an opener is only joined in front of the in-shop view
        ws.save("preview", rec_data)
        result["preview"] = rec_data
    return result


def register(sub) -> None:
    o = sub.add_parser("opener", help="a 4 s Veo opener that animates the shop's own photo")
    o.add_argument("--tool", required=True)
    o.add_argument("--photo", required=True, help="URL or local path of the shop's photo (the first frame)")
    o.add_argument("--prompt", required=True)
    o.add_argument("--seconds", type=int, default=4)
    j = sub.add_parser("join", help="put the opener in front of the recording")
    j.add_argument("--tool", required=True)
    j.add_argument("--screen", help="recording to use instead of /work/preview_T.mp4 (then --out is needed)")
    j.add_argument("--out")


def handle(a: argparse.Namespace) -> dict | None:
    if a.cmd == "opener":
        return make_opener(a.tool, a.photo, a.prompt, a.seconds)
    if a.cmd == "join":
        if bool(a.screen) != bool(a.out):
            raise ToolError("Give both --screen and --out, or neither.")
        return join(a.tool, a.screen, a.out)
    return None
