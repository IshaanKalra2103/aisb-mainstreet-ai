import json
import re
import subprocess

import httpx
import imageio_ffmpeg
import pytest

from mstools import budget, config, opener, ws


def _clip(path, seconds, size="640x360"):
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error", "-f", "lavfi", "-i",
                    f"testsrc=duration={seconds}:size={size}:rate=15", "-pix_fmt", "yuv420p", str(path)], check=True)


def _duration(path) -> float:
    r = subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-i", str(path)], capture_output=True, text=True)
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", r.stderr)
    return int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3])


@pytest.fixture
def fake(env, monkeypatch, tmp_path):
    monkeypatch.setenv("OPENROUTER_API_KEY", "k")
    monkeypatch.setenv("MS_VIDEO_POLL_SECONDS", "0")
    src = tmp_path / "src.mp4"
    _clip(src, 4)
    seen = {"posts": 0}

    def handler(request: httpx.Request):
        if request.method == "POST":
            seen["posts"] += 1
            seen["body"] = json.loads(request.content)
            return httpx.Response(202, json={"id": "v1", "status": "pending",
                                             "polling_url": "https://openrouter.ai/api/v1/videos/v1"})
        if request.url.path.endswith("/videos/v1"):
            return httpx.Response(200, json={"id": "v1", "status": "completed",
                                             "unsigned_urls": ["https://cdn.example/v1.mp4"], "usage": {"cost": 0.12}})
        return httpx.Response(200, content=src.read_bytes())

    monkeypatch.setattr(opener, "http_client", lambda: httpx.Client(transport=httpx.MockTransport(handler)))
    photo = tmp_path / "shop.jpg"
    photo.write_bytes(b"\xff\xd8\xff\xe0fakejpeg")
    return {"seen": seen, "photo": str(photo), **env}


def test_first_frame_only_and_charged_once_and_cached(fake):
    out = opener.make_opener("chat-a", fake["photo"], "steam rises")
    body = fake["seen"]["body"]
    assert [f["frame_type"] for f in body["frame_images"]] == ["first_frame"]
    assert body["duration"] == 4 and body["resolution"] == "720p" and body["aspect_ratio"] == "16:9"
    assert body["generate_audio"] is False
    assert (fake["work"] / "opener_chat-a.mp4").exists() and out["cached"] is False
    assert budget.spent(config.global_budget(), "video_global") == pytest.approx(0.12)
    again = opener.make_opener("chat-a", fake["photo"], "steam rises")
    assert again["cached"] is True and fake["seen"]["posts"] == 1
    assert budget.spent(config.global_budget(), "video_global") == pytest.approx(0.12)


def test_other_photo_is_not_reused(fake, tmp_path):
    opener.make_opener("chat-a", fake["photo"], "x")
    other = tmp_path / "b.jpg"
    other.write_bytes(b"\xff\xd8\xff\xe0other")
    opener.make_opener("chat-a", str(other), "x")
    assert fake["seen"]["posts"] == 2


def test_join_duration_and_record(fake):
    opener.make_opener("chat-a", fake["photo"], "steam")
    rec = fake["work"] / "preview_chat-a.mp4"
    _clip(rec, 10)
    ws.save("preview", {"tool_id": "chat-a", "prompt": "p", "status": "completed", "video_file": rec.name,
                        "cost_usd": 0.0, "kind": "site"})
    out = opener.join("chat-a")
    assert rec.exists()
    assert _duration(rec) == pytest.approx(4 + 10 - 0.3, abs=0.3)
    assert "opener" in out["preview"]["prompt"] and "opener" in ws.load("preview", "chat-a")["prompt"]
    n = ws.load("preview", "chat-a")["prompt"]
    opener.join("chat-a")  # twice must not stack openers
    assert _duration(rec) == pytest.approx(4 + 10 - 0.3, abs=0.3)
    assert ws.load("preview", "chat-a")["prompt"] == n
