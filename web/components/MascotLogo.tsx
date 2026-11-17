"use client";

/**
 * MascotLogo: the MainStreet AI shopfront mascot plus the "MainStreet AI." wordmark, drawn in
 * inline SVG and animated with the Web Animations API (transform and opacity only).
 *
 *   intro  ~2 s: the shop pops up and squashes on landing, the awning drops on like a roof,
 *          the eyes open, the smile arrives, the awning tips hello, the wordmark rises in
 *          letter by letter and the lime dot lands last.
 *   idle   a slow breath (awning a beat behind), a blink every 3 to 5 s (sometimes a double
 *          blink), and every 8 to 12 s one small gesture: tip the awning, look around, or hop.
 *
 * Reduced motion: settled pose, no loop. Off screen or hidden tab: nothing runs.
 * Everything between the shared markers is also inlined by the standalone preview.
 */

import { useEffect, useId, useMemo, useRef, type CSSProperties } from "react";

// @shared-start
const LIME_A = "#e8ff52";
const LIME_B = "#cdf72b";
const INK = "#16181d";
const E_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
const E_IO = "cubic-bezier(0.77, 0, 0.175, 1)";
const E_IN = "cubic-bezier(0.55, 0, 0.9, 0.5)";

const MSL_CSS = `
.msl{--s:64px;display:inline-flex;align-items:center;gap:calc(var(--s)*.12);height:var(--s);line-height:1;vertical-align:middle;color:inherit;--msl-edge:rgba(128,128,128,.32)}
.msl svg{width:var(--s);height:var(--s);flex:none;display:block;overflow:visible}
.msl .word{font-family:var(--font-fraunces),Fraunces,Georgia,serif;font-weight:700;font-size:calc(var(--s)*.4);letter-spacing:-.02em;white-space:nowrap;display:inline-flex;align-items:baseline}
.msl .mk{display:inline-block;overflow:hidden;padding:.16em .02em;margin:-.16em -.02em}
.msl .ch{display:inline-block}
.msl .sp{display:inline-block;width:.24em}
.msl .dot{display:inline-block;width:.2em;height:.2em;border-radius:50%;margin-left:.07em;background:linear-gradient(${LIME_A},${LIME_B});box-shadow:inset 0 0 0 1px rgba(0,0,0,.14);transform-origin:50% 100%}
.msl .pop{transform-origin:120px 202px}
.msl .shadow{transform-origin:120px 208px}
.msl .roofTip{transform-origin:120px 112px}
.msl .eye{transform-box:fill-box;transform-origin:50% 50%}
.msl .mouth{transform-box:fill-box;transform-origin:50% 0}
.msl[data-s="pending"] .pop,.msl[data-s="pending"] .shadow,.msl[data-s="pending"] .dot{opacity:0}
.msl[data-s="pending"] .ch{transform:translateY(110%)}
@keyframes msl-breath{0%,100%{transform:scale(1,1)}50%{transform:scale(1.012,.988)}}
@keyframes msl-roof{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.6px)}}
.msl[data-s="idle"] .breath{transform-origin:120px 202px;animation:msl-breath 4.4s ease-in-out infinite}
.msl[data-s="idle"] .roofFloat{animation:msl-roof 4.4s ease-in-out .22s infinite}
.msl[data-live="0"] .breath,.msl[data-live="0"] .roofFloat{animation-play-state:paused}
@media (prefers-reduced-motion:reduce){
.msl[data-s="pending"] .pop,.msl[data-s="pending"] .shadow,.msl[data-s="pending"] .dot{opacity:1}
.msl[data-s="pending"] .ch{transform:none}
.msl .breath,.msl .roofFloat{animation:none!important}
}
`;

function letters(s: string): string {
  return [...s].map((c) => `<span class="mk"><span class="ch">${c}</span></span>`).join("");
}

function markup(uid: string, wordmark: boolean): string {
  const word = wordmark
    ? `<span class="word" aria-hidden="true">${letters("MainStreet")}<span class="sp"></span>${letters("AI")}<span class="dot"></span></span>`
    : "";
  return `<svg viewBox="0 0 240 240" aria-hidden="true" focusable="false">
<defs>
<linearGradient id="${uid}l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${LIME_A}"/><stop offset="1" stop-color="${LIME_B}"/></linearGradient>
<linearGradient id="${uid}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7f7f2"/><stop offset="1" stop-color="#e8e8e0"/></linearGradient>
</defs>
<ellipse class="shadow" cx="120" cy="208" rx="80" ry="6" fill="rgba(0,0,0,.28)"/>
<g class="pop"><g class="breath">
<path d="M30 100H210L214 180Q214 202 192 202H48Q26 202 26 180Z" fill="url(#${uid}b)" stroke="var(--msl-edge)" stroke-width="1.5" stroke-linejoin="round"/>
<g class="face">
<ellipse class="eye" cx="83" cy="141" rx="11" ry="19" fill="${INK}"/>
<ellipse class="eye" cx="157" cy="141" rx="11" ry="19" fill="${INK}"/>
<path class="mouth" d="M102 171H138Q138 189 120 189Q102 189 102 171Z" fill="${INK}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
</g>
<g class="roofTip"><g class="roofFloat">
<path d="M20 96C20 62 36 40 68 36H172C204 40 220 62 220 96V104A25 15 0 0 1 170 104A25 15 0 0 1 120 104A25 15 0 0 1 70 104A25 15 0 0 1 20 104Z" fill="url(#${uid}l)"/>
</g></g>
</g></g>
</svg>${word}`;
}

type Ctl = {
  replay: () => void;
  destroy: () => void;
  gesture: (name: "tip" | "look" | "hop") => void;
  blink: () => void;
};

const P = (y: number, sx: number, sy: number, r: number) =>
  `translateY(${y}px) scale(${sx},${sy}) rotate(${r}deg)`;
const R = (y: number, r: number) => `translateY(${y}px) rotate(${r}deg)`;
const F = (x: number, y: number) => `translate(${x}px,${y}px)`;
type KF = [number, string, string?];
const kfs = (list: KF[], ease = E_IO): Keyframe[] =>
  list.map(([offset, transform, easing]) => ({ offset, transform, easing: easing ?? ease }));

function mountMascot(root: HTMLElement, play: "intro" | "idle"): Ctl {
  const $ = (s: string) => root.querySelector(s);
  const $$ = (s: string) => Array.from(root.querySelectorAll(s));
  const pop = $(".pop");
  const shadow = $(".shadow");
  const roofTip = $(".roofTip");
  const face = $(".face");
  const mouth = $(".mouth");
  const eyes = $$(".eye");
  const chars = $$(".ch");
  const dot = $(".dot");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const anims: Animation[] = [];
  const timers: number[] = [];
  let visible = true;
  let started = false;
  let destroyed = false;
  let lastGesture = -1;

  const isLive = () => visible && !document.hidden && !destroyed;
  const syncLive = () => root.setAttribute("data-live", isLive() ? "1" : "0");
  const run = (el: Element | null, kf: Keyframe[], opts: KeyframeAnimationOptions) => {
    if (!el) return;
    const a = el.animate(kf, opts);
    anims.push(a);
    a.finished.then(
      () => {
        const i = anims.indexOf(a);
        if (i >= 0) anims.splice(i, 1);
      },
      () => {},
    );
  };
  const after = (ms: number, fn: () => void) => {
    const id = window.setTimeout(() => {
      const i = timers.indexOf(id);
      if (i >= 0) timers.splice(i, 1);
      fn();
    }, ms);
    timers.push(id);
  };
  const clear = () => {
    timers.splice(0).forEach((t) => window.clearTimeout(t));
    anims.splice(0).forEach((a) => a.cancel());
  };

  // blink: close ~110 ms, hold ~40 ms, reopen ~190 ms (opening is slower than closing)
  const blink = () => {
    eyes.forEach((e) =>
      run(
        e,
        [
          { offset: 0, transform: "scaleY(1)", easing: E_IO },
          { offset: 0.32, transform: "scaleY(0.08)" },
          { offset: 0.44, transform: "scaleY(0.08)", easing: E_OUT },
          { offset: 1, transform: "scaleY(1)" },
        ],
        { duration: 340 },
      ),
    );
  };

  const tip = () => {
    run(
      roofTip,
      kfs([
        [0, R(0, 0)],
        [0.3, R(-8, -6)],
        [0.5, R(-3, -2)],
        [0.72, R(-7, -5)],
        [1, R(0, 0)],
      ]),
      { duration: 900 },
    );
    run(face, kfs([[0, F(0, 0)], [0.3, F(3, -2)], [0.72, F(3, -2)], [1, F(0, 0)]]), { duration: 900 });
    after(430, blink);
  };
  const look = () => {
    run(
      face,
      kfs([
        [0, F(0, 0)],
        [0.2, F(-6, 0)],
        [0.44, F(-6, 0)],
        [0.62, F(6, 0)],
        [0.84, F(6, 0)],
        [1, F(0, 0)],
      ]),
      { duration: 2400 },
    );
    run(
      pop,
      kfs([
        [0, P(0, 1, 1, 0)],
        [0.2, P(0, 1, 1, -1.6)],
        [0.44, P(0, 1, 1, -1.6)],
        [0.62, P(0, 1, 1, 1.6)],
        [0.84, P(0, 1, 1, 1.6)],
        [1, P(0, 1, 1, 0)],
      ]),
      { duration: 2400 },
    );
    after(470, blink);
    after(1380, blink);
  };
  const hop = () => {
    run(
      pop,
      kfs([
        [0, P(0, 1, 1, 0)],
        [0.2, P(1, 1.05, 0.93, 0), E_OUT],
        [0.5, P(-15, 0.97, 1.05, 0), E_IN],
        [0.78, P(0, 1.05, 0.93, 0), E_OUT],
        [0.9, P(0, 0.99, 1.01, 0)],
        [1, P(0, 1, 1, 0)],
      ]),
      { duration: 950 },
    );
    run(
      shadow,
      [
        { offset: 0, transform: "scale(1,1)", opacity: 1, easing: E_IO },
        { offset: 0.5, transform: "scale(.8,.9)", opacity: 0.6, easing: E_IN },
        { offset: 0.78, transform: "scale(1.05,1)", opacity: 1, easing: E_OUT },
        { offset: 1, transform: "scale(1,1)", opacity: 1 },
      ],
      { duration: 950 },
    );
    run(
      roofTip,
      kfs([
        [0, R(0, 0)],
        [0.2, R(2, 0)],
        [0.5, R(-4, 0)],
        [0.62, R(-2, 0)],
        [0.78, R(3, 0)],
        [0.92, R(-1, 0)],
        [1, R(0, 0)],
      ]),
      { duration: 950 },
    );
  };
  const gestures = { tip, look, hop };
  const order: ("tip" | "look" | "hop")[] = ["tip", "look", "hop"];

  const scheduleBlink = () =>
    after(2800 + Math.random() * 2400, () => {
      if (isLive()) {
        blink();
        if (Math.random() < 0.18) after(400, blink);
      }
      scheduleBlink();
    });
  const scheduleGesture = (ms: number) =>
    after(ms, () => {
      if (isLive()) {
        let i = Math.floor(Math.random() * order.length);
        if (i === lastGesture) i = (i + 1) % order.length;
        lastGesture = i;
        gestures[order[i]]();
      }
      scheduleGesture(8000 + Math.random() * 4000);
    });

  const startIdle = () => {
    root.setAttribute("data-s", "idle");
    if (reduce) return;
    scheduleBlink();
    scheduleGesture(4200);
  };

  const INTRO_MS = 2000;
  const intro = () => {
    clear();
    root.setAttribute("data-s", "pending");
    const base = { fill: "both" } as const;
    run(
      pop,
      kfs([
        [0, P(40, 0.9, 0.9, 0), E_OUT],
        [0.55, P(-7, 0.98, 1.04, 0), E_IO],
        [0.78, P(0, 1.04, 0.94, 0), E_OUT],
        [1, P(0, 1, 1, 0)],
      ]).map((k, i) => ({ ...k, opacity: i === 0 ? 0 : 1 })),
      { ...base, duration: 800 },
    );
    run(
      shadow,
      [
        { offset: 0, transform: "scale(.6,.8)", opacity: 0, easing: E_OUT },
        { offset: 0.55, transform: "scale(.9,1)", opacity: 1, easing: E_IO },
        { offset: 0.78, transform: "scale(1.04,1)", opacity: 1, easing: E_OUT },
        { offset: 1, transform: "scale(1,1)", opacity: 1 },
      ],
      { ...base, duration: 800 },
    );
    // the awning drops on like a roof, a beat after the body rises
    run(
      roofTip,
      [
        { offset: 0, transform: R(-26, 0), opacity: 0, easing: E_IN },
        { offset: 0.55, transform: R(2, 0), opacity: 1, easing: E_OUT },
        { offset: 0.78, transform: R(-2.5, 0), opacity: 1, easing: E_OUT },
        { offset: 1, transform: R(0, 0), opacity: 1 },
      ],
      { ...base, duration: 700, delay: 300 },
    );
    eyes.forEach((e) =>
      run(
        e,
        [
          { offset: 0, transform: "scaleY(0.08)", easing: E_OUT },
          { offset: 0.55, transform: "scaleY(1.1)", easing: E_IO },
          { offset: 1, transform: "scaleY(1)" },
        ],
        { ...base, duration: 620, delay: 560 },
      ),
    );
    run(
      mouth,
      [
        { offset: 0, transform: "scale(.6,.3)", opacity: 0, easing: E_OUT },
        { offset: 0.6, transform: "scale(1.06,1.08)", opacity: 1, easing: E_OUT },
        { offset: 1, transform: "scale(1,1)", opacity: 1 },
      ],
      { ...base, duration: 420, delay: 760 },
    );
    // the awning tips hello, eyes follow it
    after(1050, () => {
      tip();
    });
    chars.forEach((c, i) =>
      run(c, [{ transform: "translateY(110%)" }, { transform: "translateY(0)" }], {
        ...base,
        duration: 520,
        easing: E_OUT,
        delay: 600 + i * 38,
      }),
    );
    run(
      dot,
      [
        { offset: 0, transform: "scale(.4) translateY(-40%)", opacity: 0, easing: E_OUT },
        { offset: 0.5, transform: "scale(1.2) translateY(0%)", opacity: 1, easing: E_IO },
        { offset: 0.75, transform: "scale(.94) translateY(0%)", opacity: 1, easing: E_OUT },
        { offset: 1, transform: "scale(1) translateY(0%)", opacity: 1 },
      ],
      { ...base, duration: 560, delay: 600 + chars.length * 38 + 60 },
    );
    after(INTRO_MS, () => {
      root.setAttribute("data-s", "idle");
      // hold the settled pose, then drop the filled intro animations (end state == rest state)
      anims.splice(0).forEach((a) => a.cancel());
      startIdle();
    });
  };

  const begin = () => {
    if (started || destroyed) return;
    started = true;
    if (play === "intro" && !reduce) intro();
    else startIdle();
  };

  let io: IntersectionObserver | null = null;
  const onVis = () => {
    syncLive();
    if (isLive()) begin();
  };
  document.addEventListener("visibilitychange", onVis);
  if (typeof IntersectionObserver !== "undefined") {
    io = new IntersectionObserver((entries) => {
      visible = entries[entries.length - 1].isIntersecting;
      onVis();
    });
    io.observe(root);
  }
  syncLive();
  if (play === "intro" && !reduce) root.setAttribute("data-s", "pending");
  else root.setAttribute("data-s", "idle");
  if (isLive() && !io) begin();

  return {
    replay: () => {
      if (reduce || destroyed) return;
      started = true;
      intro();
    },
    destroy: () => {
      destroyed = true;
      clear();
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    },
    gesture: (name) => gestures[name](),
    blink,
  };
}
// @shared-end

export type MascotLogoProps = {
  /** Height and mascot width in px; the wordmark scales with it. */
  size?: number;
  /** "intro" plays the intro and then idles; "idle" starts in the settled idle loop. */
  play?: "intro" | "idle";
  /** Show "MainStreet AI." beside the mascot. */
  wordmark?: boolean;
  /** Change this number to replay the intro. */
  replayKey?: number;
  className?: string;
};

export default function MascotLogo({
  size = 64,
  play = "intro",
  wordmark = true,
  replayKey = 0,
  className,
}: MascotLogoProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const html = useMemo(() => markup(`msl${uid}`, wordmark), [uid, wordmark]);
  const ref = useRef<HTMLSpanElement>(null);
  const ctl = useRef<Ctl | null>(null);
  const firstKey = useRef(replayKey);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    ctl.current = mountMascot(el, play);
    return () => {
      ctl.current?.destroy();
      ctl.current = null;
    };
  }, [html, play]);

  useEffect(() => {
    if (replayKey !== firstKey.current) {
      firstKey.current = replayKey;
      ctl.current?.replay();
    }
  }, [replayKey]);

  return (
    <>
      <style href="mascot-logo" precedence="default">
        {MSL_CSS}
      </style>
      <span
        ref={ref}
        className={className ? `msl ${className}` : "msl"}
        data-s={play === "intro" ? "pending" : "idle"}
        style={{ "--s": `${size}px` } as CSSProperties}
        role="img"
        aria-label="MainStreet AI"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </>
  );
}
