"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { TourStep } from "@/data/demo/tours";

/*
  The guided tour on an example page. It finds each step's target by its data-tour attribute, and opens the compare and
  preview sheets (and switches the Cards / List / Setup tabs) by clicking the elements marked data-tour-action, so the
  page itself needs no tour logic. Each step first replays the bit of the saved chat that produced it, then the
  spotlight lands. A step whose target cannot be found is skipped. Esc and X close it, and with it any sheet it opened.
*/

type Phase = "prep" | "replay" | "landed";
type Rect = { top: number; left: number; width: number; height: number };
const PHONE_W = 640;
const CARD_W = 340;
const AUTO_MS = 6000;
const PAD = 6;

const q = (s: string) => document.querySelector<HTMLElement>(s);
const qLast = (s: string) => { const l = document.querySelectorAll<HTMLElement>(s); return l.length ? l[l.length - 1] : null; };
const dialogEl = () => q('[role="dialog"][aria-modal="true"]');

/** The target for a step: the first of its (comma separated) names that is on the page. The top job is the newest card, as the old one may still be leaving. */
function findTarget(names: string): HTMLElement | null {
  for (const n of names.split(",")) {
    const sel = `[data-tour="${n.trim()}"]`;
    const el = n.trim() === "top-job" ? qLast(sel) : q(sel);
    if (el && el.getBoundingClientRect().height > 0) return el;
  }
  return null;
}

/** Scrollable parents of an element, nearest first (a sheet's body, say), without the page itself. */
function scrollers(el: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight + 1) out.push(p);
  }
  return out;
}

/** Scroll so the element sits inside [top, bottom] of the screen (centred if it fits, top-aligned if not). */
function bringInto(el: HTMLElement, top: number, bottom: number) {
  const sc = scrollers(el);
  let t = top, b = bottom;
  if (sc[0]) { const cr = sc[0].getBoundingClientRect(); t = Math.max(t, cr.top + 8); b = Math.min(b, cr.bottom - 8); }
  const r = el.getBoundingClientRect();
  if (r.top >= t && r.bottom <= b) return;
  const space = b - t;
  let delta = r.height <= space ? r.top - (t + (space - r.height) / 2) : r.top - t;
  for (const s of sc) {
    const next = Math.min(s.scrollHeight - s.clientHeight, Math.max(0, s.scrollTop + delta));
    delta -= next - s.scrollTop;
    s.scrollTop = next;
  }
  if (Math.abs(delta) > 0.5) window.scrollBy({ top: delta, behavior: "instant" as ScrollBehavior });
}

/** The part of the target that is on screen and clear of the note card, with a little room around it. */
function visibleRect(el: HTMLElement, topReserve: number, bottomReserve: number): Rect {
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  let top = r.top - PAD, bottom = r.bottom + PAD, left = r.left - PAD, right = r.right + PAD;
  const sc = scrollers(el)[0];
  if (sc) { const cr = sc.getBoundingClientRect(); top = Math.max(top, cr.top); bottom = Math.min(bottom, cr.bottom); left = Math.max(left, cr.left); right = Math.min(right, cr.right); }
  top = Math.max(top, Math.max(topReserve, 4)); left = Math.max(left, 4);
  bottom = Math.min(bottom, vh - Math.max(bottomReserve, 4));
  right = Math.min(right, vw - 4);
  return { top, left, width: Math.max(right - left, 0), height: Math.max(bottom - top, 0) };
}

function sameRect(a: Rect | null, b: Rect) {
  return !!a && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;
}

/** Where the note card goes on a wide screen: beside the target, else below or above it, else the corner. */
function cardSpot(a: Rect | null, cardH: number, vw: number, vh: number): { left: number; top: number } {
  const G = 16;
  if (!a) return { left: vw - CARD_W - 24, top: vh - cardH - 24 };
  const clampY = (y: number) => Math.min(Math.max(y, G), Math.max(vh - cardH - G, G));
  if (vw - (a.left + a.width) - G * 2 >= CARD_W) return { left: a.left + a.width + G, top: clampY(a.top) };
  if (a.left - G * 2 >= CARD_W) return { left: a.left - G - CARD_W, top: clampY(a.top) };
  const x = Math.min(Math.max(a.left, G), vw - CARD_W - G);
  if (vh - (a.top + a.height) - G * 2 >= cardH) return { left: x, top: a.top + a.height + G };
  if (a.top - G * 2 >= cardH) return { left: x, top: a.top - cardH - G };
  return { left: vw - CARD_W - G, top: vh - cardH - G };
}

export default function Tour({ slug, steps, onClose }: { slug: string; steps: TourStep[]; onClose: () => void }) {
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>("prep");
  const [run, setRun] = useState({ owner: false, typing: false, agent: "" });
  const [anchor, setAnchor] = useState<Rect | null>(null);
  const [cardH, setCardH] = useState(200);
  const [vp, setVp] = useState({ w: 1280, h: 800 });
  const [auto, setAuto] = useState(false);
  const [dock, setDock] = useState<"top" | "bottom">("bottom");

  const timers = useRef(new Set<number>());
  const skip = useRef(false);
  const dir = useRef(1);
  const synthetic = useRef(false);
  const closing = useRef(false);
  const startTab = useRef<string | null>(null);
  const targetName = useRef<string | null>(null);
  const cardEl = useRef<HTMLDivElement>(null);
  const cardHRef = useRef(200);
  const reduced = useRef(typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const nextBtn = useRef<HTMLButtonElement>(null);

  const total = steps.length;
  const step = steps[idx];
  const phone = vp.w < PHONE_W;

  const wait = useCallback((ms: number) => new Promise<void>((res) => {
    const t = window.setTimeout(() => { timers.current.delete(t); res(); }, ms);
    timers.current.add(t);
  }), []);


  // On a phone the card docks at the bottom, or at the top when the target sits low in a sheet that cannot scroll.
  const dockRef = useRef<"top" | "bottom">("bottom");
  const room = () => {
    const phoneNow = window.innerWidth < PHONE_W;
    const h = phoneNow ? Math.max(cardHRef.current, 170) + 24 : 12;
    return phoneNow && dockRef.current === "top" ? { top: h, bottom: 12 } : { top: 12, bottom: h };
  };
  const measure = useCallback(() => {
    const name = targetName.current;
    const el = name ? findTarget(name) : null;
    if (!el) return;
    const rm = room();
    const r = visibleRect(el, rm.top === 12 ? 4 : rm.top, rm.bottom);
    setAnchor((prev) => (sameRect(prev, r) ? prev : r));
  }, []);
  const settle = useCallback(() => {
    const name = targetName.current;
    const el = name ? findTarget(name) : null;
    if (!el) return;
    const rm = room();
    bringInto(el, rm.top, window.innerHeight - rm.bottom);
    measure();
  }, [measure]);

  // Track the screen size, the card's height and the target's place (the page and the sheet can scroll under us).
  useEffect(() => {
    const size = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    size();
    startTab.current = q('[data-tour-action^="tab-"][aria-pressed="true"]')?.getAttribute("data-tour-action") ?? null;
    const onScroll = () => measure();
    window.addEventListener("resize", size);
    window.addEventListener("resize", onScroll);
    window.addEventListener("scroll", onScroll, true);
    const tick = window.setInterval(measure, 300);
    const card = cardEl.current;
    const ro = card && typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => setCardH(Math.round(card.getBoundingClientRect().height))) : null;
    if (card) ro?.observe(card);
    return () => {
      window.removeEventListener("resize", size);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scroll", onScroll, true);
      window.clearInterval(tick);
      ro?.disconnect();
    };
  }, [measure]);

  // Once landed, the card's height is the one the page was made room for; if it changed, make room again.
  useEffect(() => {
    if (phase !== "landed") return;
    cardHRef.current = cardH;
    if (window.innerWidth < PHONE_W) settle();
  }, [cardH, phase, settle]);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current.clear();
    dialogEl()?.querySelector<HTMLElement>('button[aria-label="Close"]')?.click();
    const back = startTab.current && q(`[data-tour-action="${startTab.current}"]`);
    if (back && back.getAttribute("aria-pressed") !== "true") back.click();
    onClose();
  }, [onClose]);

  // One step: get the page into the right state, find the target, replay the run, land the spotlight.
  useEffect(() => {
    let dead = false;
    const nap = async (ms: number) => { for (let t = 0; t < ms && !dead && !skip.current; t += 40) await wait(40); };
    const waitFor = async <T,>(fn: () => T | null | undefined | false, ms = 3000): Promise<T | null> => {
      const end = Date.now() + ms;
      while (!dead) {
        const v = fn();
        if (v) return v as T;
        if (Date.now() > end) return null;
        await wait(60);
      }
      return null;
    };
    const ensureTab = async (t: string) => {
      const b = q(`[data-tour-action="tab-${t}"]`);
      if (b && b.getAttribute("aria-pressed") !== "true") { b.click(); await wait(350); }
    };
    const onFirstCard = () => /Job 1 of/.test(qLast('[data-tour="top-job"]')?.textContent ?? "");
    const ensureFirstCard = async () => {
      if (onFirstCard()) return;
      q('[data-tour-action="tab-overview"]')?.click();
      const first = await waitFor(() => q('[data-testid="need-item"]'));
      first?.click();
      await wait(500);
      await waitFor(onFirstCard);
    };
    const nextCard = async () => {
      synthetic.current = true;
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
      synthetic.current = false;
      await wait(650);
    };

    const prepare = async (s: TourStep): Promise<boolean> => {
      const acts = s.action ? s.action.split("+") : [];
      if (dialogEl()) {
        dialogEl()?.querySelector<HTMLElement>('button[aria-label="Close"]')?.click();
        await waitFor(() => !dialogEl(), 2500);
        await wait(150);
      }
      const names = s.target.split(",").map((n) => n.trim());
      if (names.includes("setup")) await ensureTab("setup");
      else if (names.some((n) => ["top-job", "compare", "score", "preview", "decide"].includes(n))) await ensureTab("deck");
      if (acts.includes("compare")) await ensureFirstCard();
      if (names.includes("top-job")) await ensureFirstCard();
      if (acts.includes("preview") && !qLast('[data-tour-action="preview"]')) {
        await ensureFirstCard();
        for (let i = 0; i < 10 && !qLast('[data-tour-action="preview"]'); i++) await nextCard();
        if (!qLast('[data-tour-action="preview"]')) return false;
      }
      if (acts.includes("compare")) {
        const b = await waitFor(() => qLast('[data-tour-action="compare"]'));
        if (!b) return false;
        b.click();
        if (!(await waitFor(dialogEl))) return false;
        await wait(450);
      }
      if (acts.includes("score")) {
        const b = dialogEl()?.querySelector<HTMLElement>('[data-tour-action="score"]');
        if (b && b.getAttribute("aria-expanded") !== "true") b.click();
        await wait(150);
      }
      if (acts.includes("preview")) {
        qLast('[data-tour-action="preview"]')?.click();
        if (!(await waitFor(dialogEl))) return false;
        await wait(450);
      }
      return !!(await waitFor(() => findTarget(s.target), 2500));
    };

    (async () => {
      skip.current = false;
      targetName.current = null;
      setPhase("prep");
      setRun({ owner: false, typing: false, agent: "" });
      const ok = await prepare(step);
      if (dead) return;
      if (!ok) {
        // A step whose target is missing is skipped, never hangs.
        const next = idx + dir.current;
        if (next >= 0 && next < total) setIdx(next);
        else if (dir.current > 0) close();
        else { dir.current = 1; setIdx(idx + 1); }
        return;
      }
      targetName.current = step.target;
      const tEl = findTarget(step.target);
      const inSheet = !!tEl && !!dialogEl()?.contains(tEl) && scrollers(tEl).length === 0;
      dockRef.current = window.innerWidth < PHONE_W && inSheet ? "top" : "bottom";
      setDock(dockRef.current);
      settle();
      await wait(40);
      settle();
      const r = step.run;
      if (r) {
        setPhase("replay");
        if (reduced.current) setRun({ owner: !!r.owner, typing: false, agent: r.agent });
        else {
          if (r.owner) { setRun((x) => ({ ...x, owner: true })); await nap(700); }
          if (!skip.current) { setRun((x) => ({ ...x, typing: true })); await nap(800); }
          for (let i = 0; i < r.agent.length && !skip.current && !dead; i += 2) {
            setRun((x) => ({ ...x, typing: false, agent: r.agent.slice(0, i + 2) }));
            await wait(22);
          }
          await nap(500);
        }
        if (dead) return;
        setRun({ owner: !!r.owner, typing: false, agent: r.agent });
      }
      setPhase("landed");
      await wait(30);
      settle();
      if (!dialogEl()) nextBtn.current?.focus({ preventScroll: true });
    })();

    return () => {
      dead = true;
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  const next = useCallback(() => {
    if (phase === "replay") { skip.current = true; return; }
    if (phase !== "landed") return;
    if (idx >= total - 1) { if (auto) { dir.current = 1; setIdx(0); } else close(); return; }
    dir.current = 1;
    setIdx(idx + 1);
  }, [phase, idx, total, auto, close]);
  const back = useCallback(() => {
    if (idx === 0) return;
    dir.current = -1;
    setIdx(idx - 1);
  }, [idx]);

  // Play all: about 6 seconds on each step once it has landed, and round again after the last.
  useEffect(() => {
    if (!auto || phase !== "landed") return;
    const t = window.setTimeout(() => {
      dir.current = 1;
      setIdx((i) => (i >= total - 1 ? 0 : i + 1));
    }, AUTO_MS);
    return () => window.clearTimeout(t);
  }, [auto, phase, idx, total]);

  // Arrow keys step the tour (before the card deck sees them); Esc closes it and lets the sheet close too.
  const keys = useRef({ next, back, close });
  keys.current = { next, back, close };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (synthetic.current) return;
      if (e.key === "Escape") { keys.current.close(); return; }
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const t = e.target as HTMLElement | null;
      if (t?.tagName && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "ArrowRight") keys.current.next(); else keys.current.back();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const landed = phase === "landed";
  const cardPos = phone ? undefined : { ...cardSpot(anchor, cardH, vp.w, vp.h), width: CARD_W };
  const showRun = !!step.run && !(phone && landed);
  const last = idx >= total - 1;

  return (
    <div data-tour-overlay data-phase={phase} data-step={step.id} data-slug={slug} className="tour-overlay">
      <div aria-hidden className={`tour-dim ${landed ? "" : "on"}`} />
      {anchor && <div data-tour-spot aria-hidden className={`tour-spot ${landed ? "on" : ""}`}
        style={{ top: anchor.top, left: anchor.left, width: anchor.width, height: anchor.height }} />}
      <div ref={cardEl} data-tour-card role="group" aria-label="Guided tour" className={`tour-card ${phone ? `tour-card-dock ${dock === "top" ? "tour-card-top" : ""}` : ""}`} style={cardPos}>
        <div className="tour-head">
          <p className="tour-step" aria-live="polite">Step {idx + 1} of {total}</p>
          <button type="button" className="tour-link" aria-pressed={auto} onClick={() => setAuto((a) => !a)}>{auto ? "Pause" : "Play all"}</button>
          <button type="button" className="tour-x" aria-label="Close the tour" onClick={close}><X size={18} strokeWidth={2.4} aria-hidden /></button>
        </div>
        {showRun && step.run && (
          <div className="tour-run" aria-label="From the saved chat">
            <p className="tour-run-label">From the saved chat</p>
            {run.owner && <p className="tour-bubble tour-owner">{step.run.owner}</p>}
            {run.typing && <p className="tour-bubble tour-agent tour-dots" aria-label="Typing"><i /><i /><i /></p>}
            {run.agent && <p className="tour-bubble tour-agent">{run.agent}</p>}
            {phase === "replay" && <button type="button" className="tour-link" onClick={() => { skip.current = true; }}>Skip replay</button>}
          </div>
        )}
        <p className="tour-note">{step.note}</p>
        <div className="tour-bar" aria-hidden>{steps.map((s, i) => <i key={s.id} className={i <= idx ? "on" : ""} />)}</div>
        <div className="tour-nav">
          <button type="button" className="tour-btn" disabled={idx === 0} onClick={back}>Back</button>
          <button ref={nextBtn} type="button" className="tour-btn tour-primary" onClick={next}>{last ? "Done" : "Next"}</button>
        </div>
      </div>
    </div>
  );
}
