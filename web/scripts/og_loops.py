"""Looping link-preview videos (og:video) for iMessage, 1200x630, muted, H.264, faststart.

  uv run --with pillow python scripts/og_loops.py            # from web/

Writes public/og/<name>.mp4 and a same-size first frame public/og/<name>.jpg:
  demo-<slug>  an example business: its shop front with a slow push-in, then the AI preview of its first job
  home         a montage of the five example businesses' previews (also used for live owners' pages)

Each loop is seamless: the tail cross-fades into the head, so the last frame leads straight into the first.
"""
import json
import subprocess
import sys
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent
OUT = WEB / "public" / "og"
W, H, FPS = 1200, 630, 30
FADE = 0.6
SLUGS = ["coffee", "diner", "hvac", "landscaping", "salon"]


def run(args):
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode:
        sys.exit(r.stderr[-2000:])


def first_clip(slug):
    """The business's AI preview clip (previews in data/demo/<slug>.json), else the first clip in its folder."""
    data = json.loads((WEB / "data" / "demo" / f"{slug}.json").read_text())
    for p in (data.get("previews") or {}).values():
        url = (p or {}).get("video_url") or ""
        if url.startswith("/demo-media/"):
            return WEB / "public" / url.lstrip("/")
    return sorted((WEB / "public" / "demo-media" / slug).glob("*.mp4"))[0]


FILL = f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1,fps={FPS},format=yuv420p"


def still(img, secs):
    """A slow push-in on a photo. Upscaled first so the zoom moves in sub-pixel steps instead of jittering."""
    n = round(secs * FPS)
    return (["-loop", "1", "-t", f"{secs}", "-i", str(img)],
            f"scale={W * 4}:{H * 4}:force_original_aspect_ratio=increase,crop={W * 4}:{H * 4},"
            f"zoompan=z='1+0.06*on/{n}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d={n}:s={W}x{H}:fps={FPS},setsar=1,format=yuv420p")


def clip(path, start, secs):
    return (["-ss", f"{start}", "-t", f"{secs}", "-i", str(path)], FILL)


def render(name, parts, xf=FADE):
    """Join parts with cross-fades, then fold the tail onto the head so the loop has no seam."""
    args, chains = [], []
    for i, (inp, chain) in enumerate(parts):
        args += inp
        chains.append(f"[{i}:v]{chain},trim=duration={dur(inp)},setpts=PTS-STARTPTS[p{i}]")
    lens = [dur(inp) for inp, _ in parts]
    g, cur, t = chains[:], "p0", lens[0]
    for i in range(1, len(parts)):
        g.append(f"[{cur}][p{i}]xfade=transition=fade:duration={xf}:offset={t - xf:.3f}[j{i}]")
        cur, t = f"j{i}", t + lens[i] - xf
    # Seamless loop: body = full[xf:], head = full[:xf]; fade body's end into head. Result starts at full[xf]
    # and ends on full[xf - 1 frame].
    g.append(f"[{cur}]split[a][b]")
    g.append(f"[a]trim=start={xf},setpts=PTS-STARTPTS[body]")
    g.append(f"[b]trim=duration={xf},setpts=PTS-STARTPTS[head]")
    g.append(f"[body][head]xfade=transition=fade:duration={xf}:offset={t - 2 * xf:.3f},format=yuv420p[out]")
    mp4 = OUT / f"{name}.mp4"
    run(["ffmpeg", "-y", "-v", "error", *args, "-filter_complex", ";".join(g), "-map", "[out]", "-an",
         "-c:v", "libx264", "-preset", "slow", "-crf", "27", "-profile:v", "high", "-pix_fmt", "yuv420p",
         "-movflags", "+faststart", str(mp4)])
    run(["ffmpeg", "-y", "-v", "error", "-i", str(mp4), "-frames:v", "1", "-q:v", "3", str(OUT / f"{name}.jpg")])
    print(f"{name}: {t - xf:.1f}s {mp4.stat().st_size // 1024} KB")


def dur(inp):
    return float(inp[inp.index("-t") + 1])


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for slug in SLUGS:
        hero = WEB / "public" / "places" / slug / "hero.jpg"
        render(f"demo-{slug}", [still(hero, 2.4), clip(first_clip(slug), 0.8, 4.2)])
    render("home", [clip(first_clip(s), 1.0, 1.9) for s in SLUGS], xf=0.45)


if __name__ == "__main__":
    main()
