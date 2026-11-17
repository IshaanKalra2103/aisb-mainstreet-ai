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

const SHOPS = [
  { src: "/shops/salon.jpg", style: { left: "2%", top: "70px", width: 84, height: 84 } },
  { src: "/shops/diner.jpg", style: { right: "-2%", top: "330px", width: 92, height: 92 } },
  { src: "/shops/hvac.jpg", style: { left: "0%", top: "420px", width: 66, height: 66 } },
  { src: "/shops/landscaping.jpg", style: { right: "0%", top: "40px", width: 70, height: 70 } },
];

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
      {SHOPS.map((s) => <img key={s.src} src={s.src} alt="" className="ob-face" style={s.style} />)}
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
