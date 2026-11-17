"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, LayoutGroup, MotionConfig, motion, type PanInfo } from "motion/react";
import type { NeedItem, OwnerBundle, Tool, TurnEvent } from "@/lib/types";
import { ApiError, getOwner, health, mediaUrl, startTurn, streamTurn } from "@/lib/api";
import { BUSINESS_TYPE_LABELS, INTEGRATION_LABELS, catalog, priceLabel, toolById } from "@/lib/catalog";
import ToolCard from "./ToolCard";
import TrustBreakdown, { BadgePill } from "./TrustBreakdown";
import { Approval, HELPERS, SetupRecordView } from "./SetupPanel";
import OfflineBanner from "./OfflineBanner";
import ChatBox from "./ChatBox";
import TextUs from "./TextUs";
import ReadingSite from "./ReadingSite";
import { jobPhoto, placePhoto, siteLogo } from "@/lib/places";
import ToolLogo from "./ToolLogo";
import Sheet from "./Sheet";

type Preview = OwnerBundle["previews"][string];
type CardDef =
  | { key: string; kind: "intro" }
  | { key: string; kind: "job"; need: NeedItem; n: number; tool?: Tool; preview?: Preview };
/** The three ways to see the jobs: one card at a time, all of them in a list, and what our agent is setting up. */
type Mode = "deck" | "overview" | "setup";
const TABS: { id: Mode; label: string }[] = [{ id: "deck", label: "Cards" }, { id: "overview", label: "List" }, { id: "setup", label: "Setup" }];
type SheetState =
  | { kind: "compare"; need: NeedItem }
  | { kind: "trust"; tool: Tool }
  | { kind: "preview"; preview: Preview; name: string }
  | { kind: "chat" }
  | null;

const spring = { type: "spring" as const, stiffness: 320, damping: 32 };

const Icon = {
  x: <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>,
  play: <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden fill="currentColor"><path d="M7 4.5v15l13-7.5z" /></svg>,
  playSm: <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden fill="currentColor"><path d="M7 4.5v15l13-7.5z" /></svg>,
  check: <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>,
  chat: <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden fill="currentColor"><path d="M12 3C6.9 3 3 6.5 3 10.8c0 2.4 1.2 4.5 3.2 5.9L5.5 21l4.4-2.5c.7.1 1.4.2 2.1.2 5.1 0 9-3.5 9-7.9S17.1 3 12 3z" /></svg>,
  grid: <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="4" y="4" width="16" height="6" rx="2" /><rect x="4" y="14" width="16" height="6" rx="2" /></svg>,
};

function eventLine(e: TurnEvent): string {
  switch (e.type) {
    case "queued": return e.position > 0 ? `You are number ${e.position} in line. We will start soon.` : "Starting now.";
    case "status": return e.text;
    case "files": return "Updating your page with what we found.";
    case "done": return e.reply;
    case "error": return `Something went wrong: ${e.message}`;
  }
}

function previewSrc(p?: Preview): string | null {
  if (!p || p.status !== "completed") return null;
  return mediaUrl(p.video_url);
}

/** A photo of the shop; it hides itself when there is none. */
function PlaceImg({ src, className }: { src: string; className: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (failed === src) return null;
  return <img data-testid="place-photo" src={src} alt="" aria-hidden loading="lazy" decoding="async" onError={() => setFailed(src)} className={className} />;
}

/**
 * The shop's own pictures above its summary: its photo with its logo on it, the logo alone when there is no photo,
 * and nothing (no empty box) when neither loads. The logo sits on a chip of its own background colour when the file
 * has one, else on white, or on near-black when the logo itself is light.
 */
function ShopArt({ photo, logo, name }: { photo: string | null; logo: string | null; name: string }) {
  // A fixed height and auto width: an svg logo with only a viewBox would otherwise collapse to nothing.
  const [photoOk, setPhotoOk] = useState(true);
  const [logoOk, setLogoOk] = useState(true);
  const [chip, setChip] = useState<string | null>(null);
  const hasLogo = !!logo && logoOk;
  if (!(photo && photoOk) && !hasLogo) return null;
  const mark = (h: string) => hasLogo && (
    <img data-testid="shop-logo" src={logo!} alt={`${name} logo`} decoding="async" onError={() => setLogoOk(false)}
      onLoad={(e) => setChip(chipColour(e.currentTarget))} className={`block ${h} w-auto max-w-full object-contain`} />
  );
  if (photo && photoOk) {
    return (
      <div data-testid="shop-art" className="relative aspect-[16/9] overflow-hidden rounded-[var(--photo-radius)] bg-grey-tint">
        <img data-testid="place-photo" src={photo} alt="" aria-hidden decoding="async" onError={() => setPhotoOk(false)} className="absolute inset-0 h-full w-full object-cover" />
        {hasLogo && <span className="absolute bottom-3 left-3 flex max-w-[45%] items-center rounded-xl px-3 py-2 shadow-[0_2px_10px_rgb(0_0_0/.25)]" style={{ background: chip ?? "#fff" }}>{mark("h-8")}</span>}
      </div>
    );
  }
  return (
    <div data-testid="shop-art" className="flex h-28 items-center justify-center rounded-[var(--photo-radius)] px-8 py-6" style={{ background: chip ?? "#fff" }}>
      {mark("h-16")}
    </div>
  );
}

/** The chip behind a logo: the image's own corner colour if it has no transparency, else white, or near-black for a light logo. */
function chipColour(img: HTMLImageElement): string | null {
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 24;
    const g = c.getContext("2d", { willReadFrequently: true });
    if (!g) return null;
    g.drawImage(img, 0, 0, 24, 24);
    const d = g.getImageData(0, 0, 24, 24).data;
    let sum = 0, n = 0, clear = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) clear++;
      else {
        sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        n++;
      }
    }
    if (clear === 0) return `rgb(${d[0]} ${d[1]} ${d[2]})`;
    return n && sum / n > 200 ? "#1b1c1f" : "#fff";
  } catch {
    return null;
  }
}

/**
 * The photo at the top of a card: the tool's preview video, else a photo of the job or of the shop, else a plain wash.
 * A soft shade at the top and bottom keeps the pills on it readable.
 */
function CardPhoto({ src, img, className, children }: { src: string | null; img?: string | null; className?: string; children?: React.ReactNode }) {
  return (
    <div data-testid="card-media" className={`relative mx-2.5 mt-2.5 overflow-hidden rounded-[var(--photo-radius)] bg-grey-tint ${className ?? "flex-1 min-h-[96px] sm:min-h-[36%]"}`}>
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(80%_80%_at_0%_0%,var(--wash-a),transparent_70%),radial-gradient(80%_80%_at_100%_100%,var(--wash-b),transparent_70%)]" />
      {src
        ? <video src={src} muted loop autoPlay playsInline preload="auto" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
        : img && <PlaceImg src={img} className="absolute inset-0 h-full w-full object-cover" />}
      {(src || img) && <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgb(0_0_0/.38),transparent_30%,transparent_62%,rgb(0_0_0/.5))]" />}
      {children}
    </div>
  );
}

/** A small status label, like the tinted chips in the reference. */
function Pill({ children, onPhoto }: { children: React.ReactNode; onPhoto?: boolean }) {
  return (
    <span className={`inline-block rounded-full px-3 py-1 text-sm font-semibold ${onPhoto ? "glass" : "bg-grey-tint text-grey-ink"}`}>{children}</span>
  );
}

function BigButton({ icon, label, onClick, primary, disabled }: { icon: React.ReactNode; label: string; onClick: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`flex-1 min-w-0 h-12 sm:h-14 rounded-[var(--btn-radius,999px)] flex items-center justify-center gap-1.5 sm:gap-2 px-2 sm:px-3 font-semibold text-[.9rem] sm:text-base whitespace-nowrap transition-[transform,background-color] active:scale-95 disabled:opacity-50 ${primary ? "bg-primary text-on-primary hover:bg-[var(--btn-primary-hover,#2a2c30)]" : "bg-btn2 text-ink border border-btn2-line hover:bg-grey-tint"}`}>
      <span className="shrink-0">{icon}</span><span>{label}</span>
    </button>
  );
}

const CHECK_MS = 5000;
const QUIET_MS = 10 * 60_000;

export default function BusinessView({ ownerId, demo }: { ownerId: string; demo?: OwnerBundle }) {
  const live = !demo;
  const [bundle, setBundle] = useState<OwnerBundle | null>(demo ?? null);
  const [offline, setOffline] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [events, setEvents] = useState<TurnEvent[]>([]);
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState(1);
  const [mode, setMode] = useState<Mode>("deck");
  const [sheet, setSheet] = useState<SheetState>(null);
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const closeRef = useRef<(() => void) | null>(null);
  const params = useSearchParams();
  // /b/<owner>#setup (the link in our texts) opens the Setup tab, on load and when the hash changes.
  useEffect(() => {
    const fromHash = () => { if (window.location.hash === "#setup") setMode("setup"); };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);
  const initialTurn = params.get("turn");
  // The site the owner pasted on the landing page, for the wait screen's title.
  const site = params.get("site");

  // What the page last showed, when that last changed, the turn it follows and the turns it saw finish.
  const lastJson = useRef("");
  const lastChange = useRef(0);
  const following = useRef<string | null>(null);
  const finished = useRef(new Set<string>());

  const load = useCallback(async () => {
    const b = await getOwner(ownerId);
    const json = JSON.stringify(b);
    if (json !== lastJson.current) { lastJson.current = json; lastChange.current = Date.now(); setBundle(b); }
    setLoadError(false);
    return b;
  }, [ownerId]);

  const refresh = useCallback(async () => {
    try { await load(); } catch { setLoadError(true); }
  }, [load]);

  const follow = useCallback((turnId: string) => {
    closeRef.current?.();
    following.current = turnId;
    setEvents([]);
    setActive(true);
    closeRef.current = streamTurn(turnId, (e) => {
      setEvents((prev) => [...prev, e]);
      if (e.type === "files" || e.type === "done") void refresh();
      if (e.type === "done") finished.current.add(turnId);
      if (e.type === "done" || e.type === "error") {
        setActive(false);
        if (following.current === turnId) following.current = null;
        lastChange.current = Date.now();
      }
    });
  }, [refresh]);

  // While a turn runs, check for new records every few seconds, so a setup's live browser appears as soon as it starts.
  useEffect(() => {
    if (!live || !active) return;
    const t = setInterval(() => { void refresh(); }, CHECK_MS);
    return () => clearInterval(t);
  }, [live, active, refresh]);

  useEffect(() => {
    if (!live) return;
    let gone = false;
    lastChange.current = Date.now();
    health().then((ok) => { if (!gone) setOffline(!ok); });
    // After the first load, follow the turn that is running now; ?turn= can be an old one after a reload.
    getOwner(ownerId).then(
      (b) => {
        if (gone) return;
        lastJson.current = JSON.stringify(b);
        setBundle(b); setLoadError(false);
        const turn = b.active_turn ?? initialTurn;
        if (turn) follow(turn);
      },
      () => {
        if (gone) return;
        setLoadError(true);
        if (initialTurn) follow(initialTurn);
      },
    );
    return () => { gone = true; closeRef.current?.(); };
  }, [live, ownerId, follow, initialTurn]);

  // Turns also start outside this page (the owner texts us). While the page is open, visible and not following a
  // turn, check every few seconds for new records or a running turn. Every request wakes a stopped agent VM, so the
  // checks stop after QUIET_MS without a change (well inside the VM's 20-minute idle stop) and start again when the
  // owner comes back to the page.
  useEffect(() => {
    if (!live) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let gone = false;
    let lastBack = 0;
    const visible = () => document.visibilityState === "visible";
    const check = async () => {
      try {
        const turn = (await load()).active_turn;
        if (!gone && turn && turn !== following.current && !finished.current.has(turn)) follow(turn);
      } catch { /* keep what is shown; the next check tries again */ }
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (gone) return;
        if (!following.current) {
          if (Date.now() - lastChange.current >= QUIET_MS) return; // quiet: wait for the owner to come back
          if (visible()) await check();
        }
        if (!gone) schedule();
      }, CHECK_MS);
    };
    const back = () => {
      if (!visible() || Date.now() - lastBack < 2000) return;
      lastBack = Date.now();
      lastChange.current = Date.now();
      void check();
      schedule();
    };
    schedule();
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    return () => {
      gone = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("focus", back);
    };
  }, [live, load, follow]);

  const send = useCallback(async (text: string) => {
    const id = await startTurn(ownerId, text);
    follow(id);
  }, [ownerId, follow]);

  const cards: CardDef[] = useMemo(() => {
    if (!bundle) return [];
    const out: CardDef[] = [];
    if (!bundle.profile && live) out.push({ key: "intro", kind: "intro" });
    (bundle.needs?.items ?? []).forEach((need, i) => {
      const c = bundle.compares[need.need_id];
      const tool = c ? toolById(c.recommended_tool_id) : undefined;
      const preview = (tool && bundle.previews[tool.id])
        ?? Object.values(bundle.previews).find((p) => c?.options.some((o) => o.tool_id === p.tool_id));
      out.push({ key: `job-${need.need_id}`, kind: "job", need, n: i + 1, tool, preview });
    });
    return out;
  }, [bundle, live]);

  const pending = bundle?.approvals.filter((a) => a.status === "pending") ?? [];
  const records = bundle ? Object.values(bundle.setups) : [];
  // Setups the owner said "not now" to and can still say yes to: the latest per tool, while that tool has no other
  // open or approved ask and no setup record.
  const declined = (() => {
    const aps = bundle?.approvals ?? [];
    const latest = new Map<string, (typeof aps)[number]>();
    for (const a of aps) if (a.status === "rejected") latest.set(a.tool_id, a); // the API sorts them oldest first
    return [...latest.values()].filter((a) => !bundle?.setups[a.tool_id] && !aps.some((b) => b.tool_id === a.tool_id && b.status !== "rejected"));
  })();

  // The live view of each setup our agent is running in its cloud browser (TinyFish's read-only stream).
  const streams = records.filter((s) => s.streaming_url?.startsWith("http") && (s.status === "running" || s.status === "needs_owner"));
  const starting = records.filter((s) => s.status === "running" && !s.streaming_url?.startsWith("http"));

  // A new approval waiting for the owner opens the Setup tab.
  const pendingCount = pending.length;
  const [seenPending, setSeenPending] = useState(pendingCount);
  if (pendingCount !== seenPending) {
    setSeenPending(pendingCount);
    if (live && pendingCount > seenPending) setMode("setup");
  }

  const at = Math.min(index, Math.max(cards.length - 1, 0));
  const go = useCallback((to: number) => {
    if (to < 0 || to >= cards.length) return;
    setDir(to > at ? 1 : -1); setIndex(to); setActionError("");
  }, [at, cards.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (sheet || mode !== "deck") return;
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key === "ArrowRight") go(at + 1);
      if (e.key === "ArrowLeft") go(at - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, at, sheet, mode]);

  const closeSheet = useCallback(() => setSheet(null), []);

  const tabsRef = useRef<HTMLDivElement>(null);
  const show = (m: Mode) => {
    setMode(m);
    const top = tabsRef.current?.getBoundingClientRect().top;
    if (top !== undefined && top < 0) tabsRef.current?.scrollIntoView({ block: "start" });
  };
  const setItUp = async (toolId?: string) => {
    // A pending ask, or a "not now" for this job's tool that can still become a yes, is on the Setup tab.
    if (!live || pending.length || declined.some((a) => a.tool_id === toolId)) { show("setup"); return; }
    setBusy(true); setActionError("");
    try { await send("Set it up for me"); show("setup"); }
    catch (e) { setActionError(e instanceof ApiError ? e.message : "We could not reach our agent just now. Please try again in a minute."); }
    finally { setBusy(false); }
  };

  // Pinch in with two fingers on the deck to see every card at once, as in the reference video.
  const pinch = useRef<number | null>(null);
  const dist = (t: React.TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const onTouchStart = (e: React.TouchEvent) => { pinch.current = e.touches.length === 2 ? dist(e.touches) : null; };
  const onTouchMove = (e: React.TouchEvent) => {
    if (pinch.current && e.touches.length === 2 && dist(e.touches) < pinch.current * 0.7) { pinch.current = null; setMode("overview"); }
  };

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x < -90 || info.velocity.x < -600) go(at + 1);
    else if (info.offset.x > 90 || info.velocity.x > 600) go(at - 1);
  };

  const profile = bundle?.profile ?? null;
  const items = bundle?.needs?.items ?? [];
  const hours = Math.round(items.reduce((s, n) => s + n.est_hours_saved_week, 0));
  const lastEvent = events[events.length - 1];
  const statusLine = [...events].reverse().find((e) => e.type === "status" || e.type === "queued" || e.type === "files");
  // Each step the agent has reached, once, in order: the wait screen ticks them off.
  const steps = [...new Set(events.filter((e) => e.type === "status" || e.type === "queued" || e.type === "files").map(eventLine))];
  const firstNeed = items[0];
  const suggestions = [
    ...items.filter((n) => !bundle?.compares[n.need_id]).slice(0, 2)
      .map((n) => ({ label: `Compare tools: ${n.title}`, text: `Compare tools for ${n.title}` })),
    { label: "Show me a preview", text: `Show me a preview of the best tool for ${firstNeed?.title ?? "my first job"}` },
    { label: "Set it up for me", text: "Set it up for me" },
  ];

  function cardTitle(c: CardDef): string {
    switch (c.kind) {
      case "intro": return "Getting to know you";
      case "job": return c.need.title;
    }
  }
  function cardSub(c: CardDef): string {
    switch (c.kind) {
      case "intro": return "Tell us about your business";
      case "job": return `About ${c.need.est_hours_saved_week} ${c.need.est_hours_saved_week === 1 ? "hour" : "hours"} a week`;
    }
  }
  function cardSrc(c: CardDef): string | null {
    if (c.kind === "job") return previewSrc(c.preview);
    return null;
  }
  /** The photo for a job card: the job being done (a photo of the shop when we have none of the job). */
  function cardImg(c: CardDef): string | null {
    if (c.kind === "job") return jobPhoto(ownerId, c.need.need_id) ?? placePhoto(ownerId, profile, c.n);
    return null;
  }

  function renderCard(c: CardDef) {
    const src = cardSrc(c);
    if (c.kind === "job") {
      const tool = c.tool;
      return (
        <div className="flex-1 flex flex-col">
          <CardPhoto src={src} img={cardImg(c)} className="aspect-video shrink-0">
            <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-3">
              <Pill onPhoto>Job {c.n} of {items.length}</Pill>
              {src && c.preview && (
                <button type="button" aria-label={`Watch the preview of ${tool?.name ?? "this tool"}, made with AI`}
                  onClick={() => setSheet({ kind: "preview", preview: c.preview!, name: tool?.name ?? c.preview!.tool_id })}
                  className="flex items-center gap-1.5 rounded-full glass px-3 py-1 text-sm font-semibold active:scale-95 transition-transform">
                  {Icon.playSm}Watch the AI preview
                </button>
              )}
            </div>
          </CardPhoto>
          <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-3.5 sm:px-6">
            <p data-testid="card-hours" className="text-sm font-semibold text-accent-dark">{cardSub(c)}</p>
            <h2 className="mt-0.5 text-[1.4rem] sm:text-[1.7rem] font-semibold leading-[1.1] text-balance">{c.need.title}</h2>
            <p className="mt-1.5 text-base leading-snug text-muted">{c.need.why}</p>
            {tool ? (
              <div className="mt-2 sm:mt-3 rounded-2xl bg-raised border border-line/70 px-4 py-2.5 sm:py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="flex items-center gap-2 text-base">
                    <span className="text-muted">Our pick:</span>
                    <ToolLogo url={tool.url} className="size-5 rounded-[5px] bg-[#c8c9c4] p-[2px]" />
                    <strong>{tool.name}</strong>
                  </p>
                  <p className="text-base text-muted">{priceLabel(tool)}</p>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <BadgePill badge={tool.trust.badge} />
                  <span className="text-sm font-semibold tabular-nums">{tool.trust.score}/100</span>
                </div>
                <div className="mt-2 sm:mt-2.5 flex flex-wrap gap-2">
                  <button type="button" className="chip-btn" onClick={() => setSheet({ kind: "compare", need: c.need })}>Compare tools</button>
                  <button type="button" className="chip-btn" onClick={() => setSheet({ kind: "trust", tool })}>Why we trust it</button>
                </div>
              </div>
            ) : (
              <div className="mt-3 text-base text-muted">
                <p>{live ? "Want our pick for this job? We will compare the vetted tools and pick one." : "We did not compare tools for this job in this example."}</p>
                {live && <button type="button" className="chip-btn mt-2"
                  onClick={() => send(`Compare tools for ${c.need.title}`).catch((e) => setActionError(e instanceof ApiError ? e.message : "We could not reach our agent just now."))}>
                  Compare tools</button>}
              </div>
            )}
            {actionError && <p role="alert" className="mt-2 rounded-xl bg-err-tint px-3 py-2 font-semibold text-brick">{actionError}</p>}
          </div>
          <div className="shrink-0 flex gap-2 px-4 pb-4 pt-3 sm:px-5 sm:pb-5">
            <BigButton icon={Icon.x} label="Not now" onClick={() => (at < cards.length - 1 ? go(at + 1) : show("setup"))} />
            <BigButton icon={Icon.check} label={busy ? "One moment" : "Set it up"} primary disabled={busy || offline} onClick={() => setItUp(tool?.id)} />
          </div>
        </div>
      );
    }
    if (c.kind === "intro") {
      return (
        <div className="flex-1 flex flex-col">
          <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-5 sm:px-6 sm:pt-6">
            <Pill>Getting to know you</Pill>
            <h2 className="mt-5 text-[2.1rem] font-semibold leading-[1.05]">Tell us about your business</h2>
            <p className="mt-3 text-lg text-muted">Ask us a question or tell us what takes up your week. We will find the jobs AI can take off your plate.</p>
          </div>
          <div className="shrink-0 flex px-4 pb-4 pt-3 sm:px-5 sm:pb-5"><BigButton icon={Icon.chat} label="Ask us" primary onClick={() => setSheet({ kind: "chat" })} /></div>
        </div>
      );
    }
    return null;
  }

  const current = cards[at];
  // A turn running in the background shows its progress here, except on the Setup tab, which shows it beside the live browser.
  const showWorking = (active && mode !== "setup") || (!bundle && !loadError);
  // On a phone the deck has its own "Ask us" button in the row under it, so the floating one never covers a card.
  const deckOnPhone = !!bundle && !showWorking && mode === "deck" && !!current;
  // A floor, not a fixed height: a card with more to say grows instead of clipping its text.
  const cardH = "deck-card flex flex-col min-h-[clamp(480px,calc(100dvh-300px),640px)] sm:min-h-[clamp(500px,calc(100dvh-320px),720px)]";
  const shopPhoto = profile ? placePhoto(ownerId, profile, 0) : null;
  const shopLogo = profile ? siteLogo(ownerId, profile) : null;
  const tabsShown = !!bundle && (items.length > 0 || records.length > 0 || pending.length > 0 || mode === "setup");

  function renderSetup() {
    return (
      <>
        {active && (
          <div className="flex items-center gap-3 rounded-2xl bg-grey-tint px-4 py-3">
            <span aria-hidden className="soft-pulse size-3 shrink-0 rounded-full bg-[image:var(--orb)]" />
            <p className="text-base font-semibold" aria-live="polite">{statusLine ? eventLine(statusLine) : "Working on it"}</p>
          </div>
        )}
        {live ? (
          <>
            {(streams.length > 0 || starting.length > 0) && (
              <div className="grid gap-4 lg:grid-cols-2">
                {streams.map((s) => <LiveBrowser key={s.tool_id} s={s} />)}
                {starting.map((s) => <StartingBrowser key={s.tool_id} s={s} />)}
              </div>
            )}
            {pending.length > 0 && <p className="eyebrow">Waiting for your OK</p>}
            {pending.map((a) => <Approval key={`${a.id}-${a.status}`} ownerId={ownerId} a={a} onTurn={follow} onChange={refresh} />)}
            {declined.map((a) => <Approval key={`${a.id}-${a.status}`} ownerId={ownerId} a={a} onTurn={follow} onChange={refresh} />)}
            {records.map((s) => <SetupRecordView key={s.tool_id} ownerId={ownerId} s={s} live={live} liveLink={false} />)}
            {!pending.length && !declined.length && !records.length && !active && (
              <div>
                <h3 className="text-[1.6rem] font-semibold leading-tight">Nothing happens until you say yes</h3>
                <p className="mt-2 text-lg text-muted">Pick a job and press Set it up. We show you exactly what we would do and wait for your OK. Then you watch our agent set it up here, live.</p>
              </div>
            )}
          </>
        ) : <SetupReplay />}
        <div className="mt-3 border-t border-line pt-6">
          <h3 className="text-[1.6rem] font-semibold leading-tight">Prefer a person?</h3>
          <p className="mt-1 text-lg text-muted">Free help in Maryland.</p>
          <ul className="mt-3 grid gap-2">
            {HELPERS.map((h) => (
              <li key={h.name}>
                <a href={h.url} target="_blank" rel="noopener noreferrer" className="block rounded-2xl border border-line bg-raised px-4 py-2.5 hover:no-underline hover:bg-grey-tint">
                  <span className="block text-lg font-semibold">{h.name}</span>
                  <span className="block text-base text-muted leading-snug">{h.short}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto w-full max-w-[460px] px-4 pt-3 pb-28 xl:grid xl:max-w-[min(1112px,calc(100vw_-_282px))] xl:grid-cols-2 xl:items-start xl:gap-x-12 xl:pt-8">
        {offline && live && <div className="mb-4 xl:col-span-2"><OfflineBanner /></div>}

        {/* The business. From 1280 px this is the left column; the columns stop 157 px short of the right edge, which the floating Ask us button holds. */}
        <div>
          <p className="eyebrow truncate">{demo ? "Example business" : "Your business"}</p>
          <h1 className="mt-1 text-[1.9rem] sm:text-[2.2rem] xl:text-[2.6rem] font-semibold leading-[1.05] text-balance">{profile?.name ?? "Getting to know your business"}</h1>

          {/* What we understood about the shop: part of the page, not a card, so the job cards below stand apart from it. */}
          {profile && (
            <section aria-label="Your business" className="mt-4">
              <ShopArt key={`${shopPhoto}|${shopLogo}`} photo={shopPhoto} logo={shopLogo} name={profile.name} />
              <p className="mt-4 eyebrow">{profile.facts?.length ? "What we found about your shop" : "Here's what we understood"}</p>
              <p className="mt-1 text-lg text-muted">{BUSINESS_TYPE_LABELS[profile.business_type] ?? profile.business_type} in {profile.city}, {profile.state}</p>
              <p className="mt-2 text-lg leading-snug">{profile.summary}</p>
              {!!profile.facts?.length && (
                <ul className="mt-3 flex flex-col gap-2">
                  {profile.facts.slice(0, 3).map((f) => (
                    <li key={f.source_url + f.text}>
                      <a data-testid="fact" href={f.source_url} target="_blank" rel="noopener"
                        className="flex flex-col rounded-2xl bg-grey-tint px-3.5 py-2.5 text-grey-ink hover:no-underline active:scale-[0.98] transition-transform duration-150">
                        <span className="text-base leading-snug">{f.text}</span>
                        <span className="mt-0.5 text-sm text-muted">{hostOf(f.source_url)}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-base text-muted">Tools you already use:</span>
                {profile.uses.length ? profile.uses.map((u) => (
                  <span key={u} className="rounded-full bg-grey-tint px-3 py-1 text-base text-grey-ink">{INTEGRATION_LABELS[u] ?? u}</span>
                )) : <span className="text-base text-muted">none that we could see</span>}
              </div>
              <button type="button" onClick={() => setSheet({ kind: "chat" })}
                className="mt-2 min-h-11 text-base font-semibold text-ink hover:underline underline-offset-4">Not right? Tell us</button>
            </section>
          )}

          {items.length > 0 && (
            <ul aria-label="At a glance" className="mt-4 grid grid-cols-3 gap-2 border-y border-line py-4 text-center">
              <li><span className="block font-display text-[2.5rem] leading-none font-medium tabular-nums">{items.length}</span><span className="block mt-1.5 text-sm leading-tight text-muted whitespace-nowrap">jobs for AI</span></li>
              <li><span className="block font-display text-[2.5rem] leading-none font-medium tabular-nums text-accent">{hours}</span><span className="block mt-1.5 text-sm leading-tight text-muted whitespace-nowrap">hours back a week</span></li>
              <li><span className="block font-display text-[2.5rem] leading-none font-medium tabular-nums">{catalog.tools.length}</span><span className="block mt-1.5 text-sm leading-tight text-muted whitespace-nowrap">tools checked</span></li>
            </ul>
          )}

          {/* The other door: carry on in iMessage as this same shop. */}
          {live && bundle && <TextUs ownerId={ownerId} linked={!!bundle.phone_linked} />}
        </div>

        {/* Its jobs: the right column from 1280 px. */}
        <div>
          {!active && lastEvent?.type === "error" && (
            <p role="alert" className="mt-4 rounded-2xl bg-err-tint px-4 py-3 font-semibold text-brick">{eventLine(lastEvent)}</p>
          )}

          {tabsShown && (
            <div ref={tabsRef} className="mt-7 scroll-mt-3 xl:mt-0">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-2xl font-semibold">{items.length ? `${items.length} ${items.length === 1 ? "job" : "jobs"} AI can take` : "Your plan"}</h2>
                {/* On a phone, Ask us sits here instead of floating over the tabs (the deck has its own beside Back). */}
                {!deckOnPhone && (
                  <button type="button" onClick={() => setSheet({ kind: "chat" })} className="btn btn-secondary !min-h-11 !px-4 shrink-0 sm:hidden">{Icon.chat}Ask us</button>
                )}
              </div>
              <div role="group" aria-label="How to see your jobs" className="mt-3 grid grid-cols-3 gap-1 rounded-full bg-grey-tint p-1">
                {TABS.map((t) => (
                  <button key={t.id} type="button" aria-pressed={mode === t.id} onClick={() => setMode(t.id)}
                    className={`flex h-10 items-center justify-center gap-1.5 rounded-full text-base font-semibold transition-[background-color,color] duration-150 ${mode === t.id ? "bg-card text-ink shadow-sm" : "text-muted hover:text-ink"}`}>
                    {t.label}
                    {t.id === "setup" && streams.length > 0 && (
                      <span className="flex items-center gap-1 rounded-full bg-accent px-1.5 py-px text-xs font-bold text-[#141518]"><span aria-hidden className="soft-pulse size-1.5 rounded-full bg-current" />Live</span>
                    )}
                    {t.id === "setup" && !streams.length && pending.length > 0 && (
                      <span className="grid size-5 place-items-center rounded-full bg-ink text-xs font-bold text-paper">{pending.length}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          <LayoutGroup>
            {showWorking ? (
              <section aria-live="polite" aria-label="Progress" className={`card !rounded-[var(--deck-radius)] relative mt-5 overflow-hidden ${cardH}`}>
                <div className="relative flex-1 flex flex-col items-center justify-center p-6 text-center">
                  <ReadingSite photo={shopPhoto} steps={steps}
                    title={profile ? "Working on it" : site ? `Reading ${site}` : "Getting to know your shop"} />
                </div>
              </section>
            ) : !bundle ? (
              <div className="card mt-5 p-6">
                <p className="text-lg">We could not load this business page. It may have expired, or our agent may be resting.</p>
                <Link href="/demo" className="btn btn-primary mt-4">See the example businesses</Link>
              </div>
            ) : mode === "setup" ? (
              <section aria-label="Setup" className="mt-5 grid gap-4">{renderSetup()}</section>
            ) : mode === "overview" ? (
              <div className="mt-5">
                <ol aria-label="All jobs" className="grid gap-3">
                  {cards.map((c, i) => {
                    if (c.kind !== "job") return null;
                    const thumb = cardSrc(c);
                    const still = thumb ? null : cardImg(c);
                    return (
                      <li key={c.key}>
                        <motion.button layoutId={c.key} transition={spring} type="button" data-testid="need-item"
                          onClick={() => { go(i); show("deck"); }}
                          className="card !rounded-[22px] relative w-full overflow-hidden text-left hover:bg-raised active:scale-[0.98] transition-transform duration-150">
                          <span className="relative flex items-center gap-3.5 p-3">
                            {thumb
                              ? <video src={`${thumb}#t=0.5`} muted playsInline preload="metadata" aria-hidden className="size-[76px] shrink-0 rounded-2xl object-cover bg-grey-tint" />
                              : still
                                ? <img src={still} alt="" aria-hidden loading="lazy" className="size-[76px] shrink-0 rounded-2xl object-cover bg-grey-tint" />
                                : <span aria-hidden className="size-[76px] shrink-0 rounded-2xl bg-grey-tint" />}
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-semibold text-muted">Job {c.n} · {cardSub(c)}</span>
                              <span className="mt-0.5 block text-lg font-semibold leading-tight">{c.need.title}</span>
                              <span className="mt-1 flex items-center gap-1.5 text-base text-muted">
                                {c.tool
                                  ? <><ToolLogo url={c.tool.url} className="size-4 rounded-[4px] bg-[#c8c9c4] p-[1.5px]" />Our pick: <strong className="font-semibold text-ink">{c.tool.name}</strong></>
                                  : "Not compared yet"}
                              </span>
                            </span>
                            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-faint"><path d="M9 6l6 6-6 6" /></svg>
                          </span>
                        </motion.button>
                      </li>
                    );
                  })}
                </ol>
                {!items.length && <p className="text-lg text-muted">No jobs yet. Tell us about your business and we will find them.</p>}
              </div>
            ) : current ? (
              <section aria-label="Your cards" className="mt-4" onTouchStart={onTouchStart} onTouchMove={onTouchMove}>
                <div className="relative">
                  {/* The stacked edge: more cards are waiting behind this one. */}
                  {at < cards.length - 1 && <div aria-hidden className="absolute inset-x-5 -bottom-3 h-12 rounded-b-[26px] bg-card/80 border border-line shadow-sm" />}
                  {at < cards.length - 2 && <div aria-hidden className="absolute inset-x-10 -bottom-6 h-12 rounded-b-[22px] bg-card/55 border border-line/70" />}
                  <AnimatePresence initial={false} mode="popLayout" custom={dir}>
                    <motion.article
                      key={current.key}
                      layoutId={current.key}
                      custom={dir}
                      variants={{
                        enter: (d: number) => ({ x: d * 60, opacity: 0, scale: 0.97 }),
                        center: { x: 0, opacity: 1, scale: 1 },
                        exit: (d: number) => ({ x: d * -320, opacity: 0, rotate: d * -4 }),
                      }}
                      initial="enter" animate="center" exit="exit"
                      transition={spring}
                      drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={0.7} onDragEnd={onDragEnd}
                      aria-roledescription="card" aria-label={`${cardTitle(current)}, ${at + 1} of ${cards.length}`}
                      className={`card !rounded-[var(--deck-radius)] relative overflow-hidden touch-pan-y ${cardH}`}
                    >
                      {renderCard(current)}
                    </motion.article>
                  </AnimatePresence>
                </div>
                <div className="mt-9 flex items-center gap-4">
                  <button type="button" className="btn btn-secondary !min-h-11 !px-5" disabled={at === 0} onClick={() => go(at - 1)}>Back</button>
                  <p className="text-base font-semibold tabular-nums text-muted" aria-live="polite">{at + 1} of {cards.length}</p>
                  <button type="button" onClick={() => setSheet({ kind: "chat" })} className="btn btn-secondary !min-h-11 !px-4 ml-auto sm:hidden">{Icon.chat}Ask us</button>
                </div>
                <p className="mt-3 text-sm text-faint sm:hidden">Swipe left for the next card, right to go back.</p>
                <p className="mt-3 text-sm text-faint text-center hidden sm:block">Use the left and right arrow keys to move between cards.</p>
              </section>
            ) : null}
          </LayoutGroup>

        </div>
      </div>

      {!sheet && <button type="button" onClick={() => setSheet({ kind: "chat" })} aria-label="Ask us a question"
        className={`fixed bottom-5 right-5 z-40 ${tabsShown ? "hidden sm:flex" : "flex"} h-14 items-center gap-2 rounded-[var(--btn-radius,999px)] bg-float border border-btn2-line px-5 text-base font-semibold text-ink shadow-[var(--shadow-pop,0_1px_2px_rgba(0,0,0,.05),0_12px_32px_rgba(17,18,20,.12))] hover:bg-grey-tint`}>
        {Icon.chat}<span>Ask us</span>
      </button>}

      <AnimatePresence>
        {sheet?.kind === "compare" && (
          <Sheet key="compare" title={`Tools for ${sheet.need.title.toLowerCase()}`} onClose={closeSheet}>
            <div className="grid gap-4">
              {(bundle?.compares[sheet.need.need_id]?.options ?? []).map((o) => {
                const tool = toolById(o.tool_id);
                return tool ? <ToolCard key={o.tool_id} tool={tool} option={o} uses={profile?.uses}
                  recommended={o.tool_id === bundle?.compares[sheet.need.need_id]?.recommended_tool_id} /> : null;
              })}
            </div>
          </Sheet>
        )}
        {sheet?.kind === "trust" && (
          <Sheet key="trust" title={`Why we trust ${sheet.tool.name}`} onClose={closeSheet}>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <BadgePill badge={sheet.tool.trust.badge} /><span className="font-semibold">{sheet.tool.trust.score} out of 100</span>
            </div>
            <p className="text-muted mb-3">We check six things before we list a tool, and a person signs off. Each line links to what we found.</p>
            <TrustBreakdown trust={sheet.tool.trust} />
            <Link href={`/tool/${sheet.tool.id}`} className="mt-4 inline-block font-semibold">See full details</Link>
          </Sheet>
        )}
        {sheet?.kind === "preview" && (
          <Sheet key="preview" title={`See ${sheet.name} at work`} onClose={closeSheet}>
            <figure>
              <video src={previewSrc(sheet.preview) ?? undefined} autoPlay muted controls playsInline loop
                className="block w-full h-auto max-h-[70dvh] aspect-[auto_16/9] rounded-2xl bg-black object-contain" />
              <figcaption className="mt-3 text-lg font-semibold">{sheet.preview.kind === "site" ? `Preview of ${sheet.name} on a copy of your website` : `AI-generated preview of how ${sheet.name} would work in your business`}</figcaption>
            </figure>
          </Sheet>
        )}
        {sheet?.kind === "chat" && (
          <Sheet key="chat" title="Ask us anything" onClose={closeSheet} full>
            {live ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <ChatBox messages={bundle?.messages ?? []} events={events} suggestions={suggestions} onSend={send} disabled={offline} running={!!active} />
              </div>
            ) : (
              <div className="grid gap-4">
                <p className="text-muted">This is an example, so you cannot ask questions here. In a live session you can ask anything, or tell us what we got wrong.</p>
                {(bundle?.messages.length ?? 0) > 0 && (
                  <ul className="grid gap-3" aria-label="Conversation">
                    {bundle!.messages.map((m, i) => (
                      <li key={i} className={`whitespace-pre-line rounded-2xl px-4 py-2 max-w-[92%] ${m.role === "owner" ? "bg-ink text-paper ml-auto" : "bg-grey-tint"}`}>
                        <span className="sr-only">{m.role === "owner" ? "You: " : "MainStreet: "}</span>{m.text}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Sheet>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}

/** The setup agent's cloud browser, live: TinyFish's read-only stream of the run, embedded as its docs show. */
function LiveBrowser({ s }: { s: OwnerBundle["setups"][string] }) {
  const name = toolById(s.tool_id)?.name ?? s.tool_id;
  const url = s.streaming_url!;
  return (
    <figure className="overflow-hidden rounded-[var(--photo-radius)] border border-line bg-card">
      <figcaption className="flex items-center justify-between gap-3 px-4 py-2.5">
        <span className="flex min-w-0 items-center gap-2 font-semibold">
          <span aria-hidden className="soft-pulse size-2.5 shrink-0 rounded-full bg-accent" />
          <span className="truncate">Live: {name}</span>
        </span>
        <a href={url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-sm font-semibold">Open full screen</a>
      </figcaption>
      {/* View-only, as Browser Use's docs show: inert + no pointer events, so nobody can type into the agent's browser. */}
      <div {...{ inert: true }} style={{ pointerEvents: "none" }}>
        <iframe src={url} title={`${name} setup, live`} tabIndex={-1} allow="autoplay" style={{ pointerEvents: "none" }}
          className="block aspect-[16/10] w-full border-0 bg-grey-tint" />
      </div>
    </figure>
  );
}

/** The slot of the live window while the agent's cloud browser is still starting up. */
function StartingBrowser({ s }: { s: OwnerBundle["setups"][string] }) {
  const name = toolById(s.tool_id)?.name ?? s.tool_id;
  return (
    <figure className="overflow-hidden rounded-[var(--photo-radius)] border border-line bg-card">
      <figcaption className="flex items-center gap-2 px-4 py-2.5 font-semibold">
        <span aria-hidden className="soft-pulse size-2.5 shrink-0 rounded-full bg-accent" />
        <span className="truncate">Live: {name}</span>
      </figcaption>
      <div className="grid aspect-[16/10] w-full place-items-center bg-grey-tint text-lg text-muted">Starting the browser…</div>
    </figure>
  );
}

/** On an example business: a recorded run of the setup agent (the sign-up email is blurred), and what happens in a live one. */
function SetupReplay() {
  const steps = [
    "You say yes to the plan we show you. Nothing starts before that.",
    "Our agent opens the tool's sign-up in its own cloud browser and fills in your shop's details, with a new inbox we made for it.",
    "Our agent gets past robot checks by itself. Only a step that needs your phone, your ID or a payment comes back to you.",
    "You get a link to what we set up and a short list of what is next.",
  ];
  return (
    <div>
      <figure className="overflow-hidden rounded-[var(--photo-radius)] border border-line bg-white">
        <figcaption className="flex items-center gap-2 border-b border-black/10 bg-[#f4f4f2] px-3.5 py-2 text-sm text-[#55575c]">
          <span className="rounded-full bg-[#202226] px-2.5 py-0.5 font-semibold text-white">Recorded run</span>
          <span className="truncate">app.chatling.ai/register</span>
        </figcaption>
        <video data-testid="setup-replay" src="/setup/chatling-signup.mp4" poster="/setup/chatling-signup.jpg" muted loop autoPlay playsInline preload="metadata"
          aria-label="Our setup agent filling in a Chatling sign-up form, then getting past the robot check" className="block aspect-[8/9] w-full object-cover" />
      </figure>
      <p className="mt-4 text-lg leading-snug">Our setup agent signing a shop up for Chatling. In a live session you watch your own setup happen here, as it runs.</p>
      <ol className="mt-4 grid gap-3">
        {steps.map((t, i) => (
          <li key={t} className="flex gap-3 text-base leading-snug">
            <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-grey-tint font-display text-sm font-semibold tabular-nums">{i + 1}</span>
            <span className="pt-0.5">{t}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** "https://www.google.com/maps/..." -> "google.com" (the source shown under a fact). */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
