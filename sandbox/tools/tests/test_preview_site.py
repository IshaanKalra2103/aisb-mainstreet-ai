"""The "your site" clip: site-info reads the shop's homepage, frames renders the one-file rebuild, make uses both frames."""
import base64
import contextlib
import json
import sys
import types

import httpx
import pytest

from mstools import browseruse, preview, ws
from mstools.preview import FRAME_CSS

PNG = b"\x89PNG\r\n\x1a\nfake"
HTML = "<!doctype html><html><body><h1>Vigilante</h1>\n<!-- tool --><div id=chat></div><!-- /tool -->\n</body></html>"


def _cli(monkeypatch, capsys, *argv, handler=None):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    monkeypatch.setenv("MS_VIDEO_POLL_SECONDS", "0")
    if handler:
        monkeypatch.setattr(preview, "http_client", lambda: httpx.Client(transport=httpx.MockTransport(handler)))
    monkeypatch.setattr(sys, "argv", ["preview", *argv])
    with pytest.raises(SystemExit) as e:
        preview.main()
    return e.value.code, json.loads(capsys.readouterr().out.strip().splitlines()[-1])


def _video(seen):
    def handler(req):
        if req.method == "POST":
            seen["body"] = json.loads(req.content)
            return httpx.Response(202, json={"id": "v1", "polling_url": "https://openrouter.ai/api/v1/videos/v1"})
        if req.url.path.endswith("/videos/v1"):
            return httpx.Response(200, json={"status": "completed", "unsigned_urls": ["https://cdn.example/v.mp4"],
                                             "usage": {"cost": 0.4}})
        return httpx.Response(200, content=b"mp4")
    return handler


def test_make_with_frames_sends_first_and_last_and_records_a_site_clip(env, monkeypatch, capsys):
    (env["work"] / "demo_first.png").write_bytes(PNG)
    (env["work"] / "demo_last.png").write_bytes(PNG)
    seen = {}
    code, out = _cli(monkeypatch, capsys, "make", "--tool", "chatling", "--prompt", "The chat opens on the cafe site",
                     "--first", str(env["work"] / "demo_first.png"), "--last", str(env["work"] / "demo_last.png"),
                     handler=_video(seen))
    assert code == 0 and out["preview"]["kind"] == "site" and out["preview"]["status"] == "completed"
    frames = seen["body"]["frame_images"]
    assert [f["frame_type"] for f in frames] == ["first_frame", "last_frame"]
    assert frames[0]["type"] == "image_url"
    assert frames[0]["image_url"]["url"] == "data:image/png;base64," + base64.b64encode(PNG).decode()
    assert seen["body"]["duration"] == 8
    assert ws.load("preview", "chatling")["kind"] == "site"


def test_make_without_frames_is_unchanged(env, monkeypatch, capsys):
    seen = {}
    code, out = _cli(monkeypatch, capsys, "make", "--tool", "chatling", "--prompt", "p", handler=_video(seen))
    assert "frame_images" not in seen["body"] and out["preview"]["kind"] == "plain"


def test_a_plain_clip_does_not_satisfy_a_site_request(env, monkeypatch, capsys):
    (env["work"] / "preview_chatling.mp4").write_bytes(b"x")
    ws.save("preview", {"tool_id": "chatling", "prompt": "p", "status": "completed", "video_file": "preview_chatling.mp4"})
    (env["work"] / "a.png").write_bytes(PNG)
    seen = {}
    code, out = _cli(monkeypatch, capsys, "make", "--tool", "chatling", "--prompt", "p", "--first",
                     str(env["work"] / "a.png"), "--last", str(env["work"] / "a.png"), handler=_video(seen))
    assert out["cached"] is False and "frame_images" in seen["body"]


def test_frames_needs_the_one_file_with_a_tool_block(env, monkeypatch, capsys):
    code, out = _cli(monkeypatch, capsys, "frames", "--html", str(env["work"] / "tmp/demo/index.html"))
    assert code == 1 and "index.html" in out["error"]
    page = env["work"] / "index.html"
    page.write_text("<html><body>no block</body></html>")
    code, out = _cli(monkeypatch, capsys, "frames", "--html", str(page))
    assert code == 1 and "<!-- tool -->" in out["error"]


class _Page:
    def __init__(self, log):
        self.log, self.url = log, "about:blank"

    async def set_viewport_size(self, size):
        self.log.append(("viewport", size))

    async def goto(self, url, wait_until=None, timeout=None):
        self.log.append(("goto", url, wait_until))

    async def wait_for_load_state(self, *a, **k):
        return None

    async def wait_for_timeout(self, ms):
        self.log.append(("wait", ms))

    async def evaluate(self, js, *a):
        self.log.append(("eval", js))

    async def screenshot(self, path=None, **k):
        self.log.append(("shot", path, k.get("clip"), k.get("type")))
        open(path, "wb").write(PNG)


def test_frames_shoots_closed_then_open(env, monkeypatch, capsys):
    log = []

    @contextlib.asynccontextmanager
    async def fake(proxy=None, width=1440, height=900, minutes=10, on_live=None):
        assert (width, height) == (1280, 1080)  # a 1080 screen leaves a page at least 720 tall under the toolbar
        yield _Page(log), {"id": "b1"}
    monkeypatch.setattr(browseruse, "browser", fake)
    page = env["work"] / "index.html"
    page.write_text(HTML)
    code, out = _cli(monkeypatch, capsys, "frames", "--html", str(page))
    assert code == 0 and out["first"].endswith("demo_first.jpg") and out["last"].endswith("demo_last.jpg")
    # Measured on Browser Use: set_content never sees "load", viewport emulation is ignored (innerHeight 474 under a
    # 1280x720 screen) and the pixel ratio changes per browser. So: a data: URL, the page pinned to a 1280x720 frame
    # (a transform on body anchors position:fixed to it) and a 1280x720 clip.
    goto = next(e for e in log if e[0] == "goto")
    assert goto[1].startswith("data:text/html;base64,") and goto[2] == "load"
    sent = base64.b64decode(goto[1].split(",", 1)[1]).decode()
    assert FRAME_CSS in sent and "<h1>Vigilante</h1>" in sent and "<!-- tool -->" in sent
    assert all(e[2] == {"x": 0, "y": 0, "width": 1280, "height": 720} and e[3] == "jpeg" for e in log if e[0] == "shot")
    shots = [i for i, e in enumerate(log) if e[0] == "shot"]
    opened = next(i for i, e in enumerate(log) if e[0] == "eval" and "classList.add('open')" in e[1])
    assert shots[0] < opened < shots[1]
    assert (env["work"] / "demo_first.jpg").read_bytes() == PNG


def test_site_info_fails_fast_when_the_browser_is_unavailable(env, monkeypatch, capsys):
    @contextlib.asynccontextmanager
    async def fake(**k):
        raise browseruse.Unavailable("no key")
        yield
    monkeypatch.setattr(browseruse, "browser", fake)
    code, out = _cli(monkeypatch, capsys, "site-info", "--url", "https://vigilantecoffee.com")
    assert code == 1 and "Could not open the website" in out["error"]


def test_a_jpeg_frame_is_sent_as_jpeg(env, monkeypatch, capsys):
    (env["work"] / "demo_first.jpg").write_bytes(b"\xff\xd8jpg")
    seen = {}
    _cli(monkeypatch, capsys, "make", "--tool", "chatling", "--prompt", "p", "--first", str(env["work"] / "demo_first.jpg"),
         "--last", str(env["work"] / "demo_first.jpg"), handler=_video(seen))
    assert seen["body"]["frame_images"][0]["image_url"]["url"].startswith("data:image/jpeg;base64,")


STEPPED = ("<!doctype html><html><head></head><body><h1>Vigilante</h1>\n<!-- tool -->"
           "<button data-step='1' data-act='click' data-opens>chat</button><div data-panel>"
           "<div data-step='3' data-act='show'>Do you sell beans?</div>"
           "<div data-step='4' data-act='show' data-typing>Yes, Peru and Kenya.</div>"
           "<input data-step='2' data-act='type' data-text='Do you sell beans?'></div><!-- /tool -->\n</body></html>")


class _RecPage(_Page):
    async def evaluate(self, js, *a):
        self.log.append(("eval", js, *a))
        if "__mt.total" in js:
            return 1.0


def test_record_needs_numbered_steps_in_the_tool_block(env, monkeypatch, capsys):
    page = env["work"] / "index.html"
    page.write_text(HTML)
    code, out = _cli(monkeypatch, capsys, "record", "--tool", "chatling", "--html", str(page))
    assert code == 1 and "data-step" in out["error"]


def test_record_seeks_and_shoots_every_frame_then_saves_a_site_clip(env, monkeypatch, capsys):
    log, encoded = [], {}

    @contextlib.asynccontextmanager
    async def fake(proxy=None, width=1440, height=900, minutes=10, on_live=None):
        assert (width, height) == (1280, 1080)
        yield _RecPage(log), {"id": "b1"}

    def encode(frames_dir, fps, out):
        encoded.update(n=len(list(frames_dir.glob("f*.jpg"))), fps=fps)
        out.write_bytes(b"mp4")
    monkeypatch.setattr(browseruse, "browser", fake)
    monkeypatch.setattr(preview, "_encode", encode)
    page = env["work"] / "index.html"
    page.write_text(STEPPED)
    code, out = _cli(monkeypatch, capsys, "record", "--tool", "chatling", "--html", str(page))
    assert code == 0 and out["preview"]["kind"] == "site" and out["preview"]["status"] == "completed"
    assert out["preview"]["video_file"] == "preview_chatling.mp4" and out["preview"]["cost_usd"] == 0
    sent = base64.b64decode(next(e for e in log if e[0] == "goto")[1].split(",", 1)[1]).decode()
    assert FRAME_CSS in sent and "window.__mt" in sent and sent.index("window.__mt") > sent.index("<!-- /tool -->")
    seeks = [e[2] for e in log if e[0] == "eval" and "__mt.seek" in e[1]]
    # 1 s of timeline at the recording rate, every frame drawn exactly at its own time and shot clipped to the frame
    assert seeks == [i / preview.REC_FPS for i in range(preview.REC_FPS + 1)]
    shots = [e for e in log if e[0] == "shot"]
    assert len(shots) == len(seeks) and all(e[2] == preview.FRAME and e[3] == "jpeg" for e in shots)
    assert encoded == {"n": len(seeks), "fps": preview.REC_FPS}
    assert (env["work"] / "preview_chatling.mp4").read_bytes() == b"mp4"


def test_record_in_shop_view_saves_a_shop_clip(env, monkeypatch, capsys):
    @contextlib.asynccontextmanager
    async def fake(proxy=None, width=1440, height=900, minutes=10, on_live=None):
        yield _RecPage([]), {"id": "b1"}
    monkeypatch.setattr(browseruse, "browser", fake)
    monkeypatch.setattr(preview, "_encode", lambda frames_dir, fps, out: out.write_bytes(b"mp4"))
    page = env["work"] / "index.html"
    page.write_text(STEPPED)
    code, out = _cli(monkeypatch, capsys, "record", "--tool", "chatling", "--html", str(page), "--view", "shop")
    assert code == 0 and out["preview"]["kind"] == "shop" and "in front of the shop" in out["preview"]["prompt"]
    assert ws.load("preview", "chatling")["kind"] == "shop"


def test_record_failure_points_to_the_frames_clip(env, monkeypatch, capsys):
    @contextlib.asynccontextmanager
    async def fake(**k):
        raise browseruse.Unavailable("no key")
        yield
    monkeypatch.setattr(browseruse, "browser", fake)
    page = env["work"] / "index.html"
    page.write_text(STEPPED)
    code, out = _cli(monkeypatch, capsys, "record", "--tool", "chatling", "--html", str(page))
    assert code == 1 and "preview make" in out["error"] and "--first" in out["error"]
