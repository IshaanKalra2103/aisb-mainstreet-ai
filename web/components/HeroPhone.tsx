"use client";
import { useEffect, useRef, useState } from "react";

/**
 * The first texts, playing in dark Messages (Poke's phone above the fold, Clerk's scripted chat). The script runs once on
 * load, with the typing dots before each reply, then holds on the plan. Reduced motion shows the whole thread at once.
 */
type Line = { kind: "out" | "in" | "link"; text: string; wait: number };
const SCRIPT: Line[] = [
  { kind: "out", text: "hi it's Maria at Bean & Brick, beanandbrick.com", wait: 700 },
  { kind: "in", text: "Hi Maria! I read beanandbrick.com.", wait: 1500 },
  { kind: "in", text: "3 jobs I'd hand off first: missed calls, review replies, and your Instagram.", wait: 1700 },
  { kind: "link", text: "Bean & Brick: your plan", wait: 1400 },
  { kind: "in", text: "First up: missed calls. Want me to show you how it works?", wait: 1900 },
];

// The shops around the phone: each drifts on its own loop, leans a little toward the cursor (depth = px at the
// window's edge, the sign sets the direction) and, on hover or tap, says the job we would take off its plate.
const SHOPS = [
  { src: "/shops/salon.jpg", kind: "Salon", job: "Auto-booking", depth: 24, size: 96, pos: { left: "0%", top: "64px" } },
  { src: "/shops/landscaping.jpg", kind: "Landscaping", job: "Quote follow-ups", depth: -26, size: 84, pos: { right: "0%", top: "34px" } },
  { src: "/shops/diner.jpg", kind: "Diner", job: "Review replies", depth: 22, size: 104, pos: { right: "-3%", top: "320px" } },
  { src: "/shops/hvac.jpg", kind: "HVAC", job: "Missed-call text back", depth: -20, size: 80, pos: { left: "-1%", top: "410px" } },
];

function Shops() {
  const layers = useRef<(HTMLDivElement | null)[]>([]);
  const [open, setOpen] = useState<number | null>(null);

  // Cursor parallax, eased toward the pointer; the loop runs only while the bubbles are still catching up.
  useEffect(() => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0;
    const step = () => {
      cx += (tx - cx) * 0.08;
      cy += (ty - cy) * 0.08;
      layers.current.forEach((el, i) => {
        if (el) el.style.transform = `translate3d(${(cx * SHOPS[i].depth).toFixed(2)}px, ${(cy * SHOPS[i].depth).toFixed(2)}px, 0)`;
      });
      raf = Math.abs(tx - cx) + Math.abs(ty - cy) > 0.0005 ? requestAnimationFrame(step) : 0;
    };
    const onMove = (e: PointerEvent) => {
      tx = e.clientX / window.innerWidth - 0.5;
      ty = e.clientY / window.innerHeight - 0.5;
      if (!raf) raf = requestAnimationFrame(step);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => { window.removeEventListener("pointermove", onMove); cancelAnimationFrame(raf); };
  }, []);

  // A tap shows a bubble's job (touch has no hover); a tap anywhere else puts it away.
  useEffect(() => {
    if (open === null) return;
    const close = () => setOpen(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);

  return SHOPS.map((s, i) => (
    <div key={s.src} ref={(el) => { layers.current[i] = el; }} className="ob-shop" style={s.pos} data-open={open === i || undefined}
      onClick={(e) => { e.stopPropagation(); setOpen(open === i ? null : i); }}>
      <div className={`ob-shop-float ob-drift-${i + 1}`}>
        <span className="ob-shop-photo" style={{ width: s.size, height: s.size }}><img src={s.src} alt="" /></span>
        <span className="ob-shop-tag">{s.kind}<i>&middot;</i><b>{s.job}</b></span>
      </div>
    </div>
  ));
}

export default function HeroPhone() {
  const [shown, setShown] = useState(0);
  const [typing, setTyping] = useState(false);
  const thread = useRef<HTMLDivElement>(null);

  // Like Messages: a short thread sits at the top; once it fills the screen, each new text scrolls the older ones up.
  useEffect(() => {
    const el = thread.current;
    if (!el) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight, behavior: calm ? "auto" : "smooth" });
  }, [shown, typing]);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      timers.push(setTimeout(() => setShown(SCRIPT.length), 0));
      return () => timers.forEach(clearTimeout);
    }
    let t = 500;
    SCRIPT.forEach((line, i) => {
      if (line.kind !== "out") {
        timers.push(setTimeout(() => setTyping(true), t));
        t += line.wait;
      } else {
        t += line.wait;
      }
      timers.push(setTimeout(() => { setTyping(false); setShown(i + 1); }, t));
      t += 350;
    });
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="ob-phone-wrap" aria-hidden>
      <Shops />
      <div className="ob-phone">
        <div className="ob-screen">
          <div className="ob-island" />
          <div className="ob-imhead">
            <img src="/brand/mark.jpg" alt="" />
            <span>MainStreet AI &rsaquo;</span>
          </div>
          <div className="ob-thread" ref={thread}>
            <div className="ob-stamp"><b>iMessage</b><br />Today 9:41 AM</div>
            {SCRIPT.slice(0, shown).map((line, i) => line.kind === "link" ? (
              <div key={i} className="ob-link ob-in">
                <img src="/shops/coffee.jpg" alt="" />
                <div>{line.text}<small>mainstreet-ai-five.vercel.app</small></div>
              </div>
            ) : (
              <div key={i} className={`ob-b ${line.kind} ob-in`}>{line.text}</div>
            )).flatMap((el, i) => i === 0 ? [el, <div key="d" className="ob-delivered">Delivered</div>] : [el])}
            {typing && <div className="ob-typing ob-in"><i /><i /><i /></div>}
          </div>
          <div className="ob-bar"><span /><span>iMessage</span></div>
          <div className="ob-home" />
        </div>
      </div>
    </div>
  );
}
