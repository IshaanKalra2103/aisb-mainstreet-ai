// iMessage relay logic, kept free of Photon so it can be unit tested.
//
// One inbound text becomes one POST /api/imessage {from_hash, text}. The API answers with
// {replies: string[] (<= 3), link}; we send each reply 3 s apart, then the link. A 429 carries
// the text to send the owner in `detail`. Anything else that goes wrong gets SORRY.
//
// Logs carry a short sender hash only: never a phone number, email or message text.
import { createHash } from "node:crypto";

export const SORRY = "Sorry, something broke on our side. Try again in a minute.";
export const GAP_MS = 3_000;
export const TIMEOUT_MS = 300_000; // the API waits up to ~280 s for a turn

/** RELAY_TIMEOUT_MS as a positive number of ms, or undefined to keep TIMEOUT_MS (a cold GCP VM adds ~90 s). */
export function timeoutFromEnv(v: string | undefined): number | undefined {
  const n = Number(v);
  return v && Number.isFinite(n) && n > 0 ? n : undefined;
}
export const MAX_TEXT = 2_000; // the API rejects longer texts with a 422
export const MAX_REPLIES = 3;
export const MAX_VIDEO_BYTES = 25_000_000; // iMessage takes bigger, but this keeps the e2-micro safe

/** The parts of a spectrum-ts `Message` the relay reads. */
export interface IncomingLike {
  direction?: string;
  sender?: { id?: string; kind?: string } | undefined;
  content: { type: string; text?: unknown; option?: { title?: unknown }; poll?: { title?: unknown }; selected?: unknown };
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface RelayDeps {
  apiUrl: string;
  secret?: string | undefined;
  fetch: FetchLike;
  send: (text: string) => Promise<unknown>;
  /** Rich link preview card; without it a link goes out as a text. */
  sendLink?: (url: string) => Promise<unknown>;
  /** Inline attachment from bytes; without it the video is skipped. */
  sendVideo?: (bytes: Uint8Array, name: string) => Promise<unknown>;
  sleep?: (ms: number) => Promise<void>;
  /** Best effort typing indicator while the agent works; failures are ignored. */
  typing?: (on: boolean) => Promise<unknown>;
  log?: (line: string) => void;
  gapMs?: number;
  timeoutMs?: number;
  /**
   * Native "share your location" request (Photon's Find My kit) to `who`, the sender's phone or Apple ID. With it,
   * the share page card (".../shop") is replaced by the request. "pending" means one is already waiting on the owner.
   */
  requestLocation?: (who: string) => Promise<"sent" | "pending" | "failed">;
  /** Resolves with the spot `who` shares, or null when they don't share in time. */
  waitLocation?: (who: string) => Promise<SharedSpot | null>;
  /** A spot `who` shared after their wait ran out, checked when they text again; null when there is none. */
  lateLocation?: (who: string) => Promise<SharedSpot | null>;
  /** Runs the wait for a shared spot without holding up this reply. Default: fire and forget. */
  background?: (work: Promise<unknown>) => void;
  /** iMessage app card (Apple's MSMessageTemplateLayout). With it, the owner's page goes out as a plan card. */
  sendCard?: (url: string, layout: CardLayout) => Promise<unknown>;
  /** Native iMessage poll. With it, a pending approval the API offers goes out as a yes/no poll. */
  sendPoll?: (question: string, options: string[]) => Promise<unknown>;
}

/** A vote on one of our polls: the poll's title and the option tapped. */
export interface Vote {
  senderId: string;
  poll: string;
  option: string;
}

/** A vote to pass on, or null. Taking a vote back (selected false) is not acted on. */
export function votable(msg: IncomingLike): Vote | null {
  if (msg.direction === "outbound" || msg.sender?.kind === "agent") return null;
  const c = msg.content;
  if (c?.type !== "poll_option" || c.selected !== true) return null;
  const poll = typeof c.poll?.title === "string" ? c.poll.title.trim() : "";
  const option = typeof c.option?.title === "string" ? c.option.title.trim() : "";
  const senderId = (msg.sender?.id ?? "").trim();
  return poll && option && senderId ? { senderId, poll: poll.slice(0, 300), option } : null;
}

/** The visible slots of an iMessage app card. `image` (JPEG) and `imageTitle` go together. */
export interface CardLayout {
  caption?: string;
  subcaption?: string;
  trailingCaption?: string;
  trailingSubcaption?: string;
  image?: Uint8Array<ArrayBuffer>;
  imageTitle?: string;
  imageSubtitle?: string;
  /** Fallback text where the card can't render. */
  summary?: string;
}

export interface SharedSpot {
  lat: number;
  lon: number;
  /** Accuracy radius in metres. */
  acc: number;
}

/** The share page's turn text (web/lib/shop.ts shopTurnText): the agent's intake skill reads this shape. */
export const shopTurnText = (s: SharedSpot): string =>
  `Here is my shop. Location: ${s.lat.toFixed(5)}, ${s.lon.toFixed(5)} (within ${Math.max(1, Math.ceil(s.acc))} m). Link: none`;

const PAGE_RE = /^(https?:\/\/[^/]+)\/b\/(o_[a-z0-9]{6,32})\/?$/;
const KINDS: Record<string, string> = {
  restaurant: "Restaurant", coffee_shop: "Coffee shop", hvac: "HVAC", landscaping: "Landscaping", salon: "Salon",
};
export const MAX_PHOTO_BYTES = 1_000_000;

const hoursLabel = (h: number) => {
  const n = Math.round(h * 10) / 10;
  return `${n} hr${n === 1 ? "" : "s"}`;
};

/**
 * The plan card for an owner's page link: the street photo (the web's /api/street, as on the page), the shop's name
 * and place, the number of jobs and the hours back a week. Null until the agent has a profile and jobs, or when
 * the page can't be read; the page then goes out as a link card.
 */
export async function planCard(url: string, deps: RelayDeps): Promise<CardLayout | null> {
  const m = PAGE_RE.exec(url);
  if (!m) return null;
  const [, origin, oid] = m;
  let b: any;
  try {
    const res = await deps.fetch(`${deps.apiUrl.replace(/\/+$/, "")}/api/owners/${oid}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    b = await res.json();
  } catch {
    return null;
  }
  const p = b?.profile;
  const items: any[] = Array.isArray(b?.needs?.items) ? b.needs.items : [];
  if (!p?.name || !items.length) return null;
  const hours = items.reduce((t, n) => t + (Number(n?.est_hours_saved_week) || 0), 0);
  const jobs = `${items.length} job${items.length === 1 ? "" : "s"} AI can take`;
  const place = [p.city, p.state].filter(Boolean).join(", ");
  const kind = KINDS[p.business_type] ?? "";
  const nums = { trailingCaption: hoursLabel(hours), trailingSubcaption: "back a week", summary: `${p.name}: your AI plan` };

  const q = new URLSearchParams();
  if (typeof p.lat === "number" && typeof p.lon === "number") {
    q.set("lat", p.lat.toFixed(5));
    q.set("lon", p.lon.toFixed(5));
  } else if (place) q.set("q", place);
  let image: Uint8Array<ArrayBuffer> | undefined;
  if (q.size) {
    try {
      const res = await deps.fetch(`${origin}/api/street?${q}`, { signal: AbortSignal.timeout(10_000) });
      const bytes = res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
      if (bytes && bytes.length > 2 && bytes.length <= MAX_PHOTO_BYTES && bytes[0] === 0xff && bytes[1] === 0xd8) image = bytes;
    } catch {
      /* no photo: the card still goes */
    }
  }
  if (!image) return { caption: p.name, subcaption: `Your AI plan · ${jobs}`, ...nums };
  return {
    image,
    imageTitle: p.name,
    imageSubtitle: [kind, place].filter(Boolean).join(" · ") || "Your shop",
    caption: "Your AI plan",
    subcaption: jobs,
    ...nums,
  };
}

const isShopLink = (url: string) => /\/b\/[^/?#]+\/shop\/?$/.test(url);

export type Outcome = "ignored" | "replied" | "rate_limited" | "error" | "send_failed";

export const hashSender = (id: string): string => createHash("sha256").update(id, "utf8").digest("hex");

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The sender id and text to relay, or null for messages we skip (ours, non-text, empty). */
export function relayable(msg: IncomingLike): { senderId: string; text: string } | null {
  if (msg.direction === "outbound" || msg.sender?.kind === "agent") return null;
  if (msg.content?.type !== "text" || typeof msg.content.text !== "string") return null;
  const text = msg.content.text.trim();
  const senderId = (msg.sender?.id ?? "").trim();
  if (!text || !senderId) return null;
  return { senderId, text: text.slice(0, MAX_TEXT) };
}

/** An error whose message is safe to log (no sender id, no text). */
class RelayError extends Error {}

type Poll = { question: string; options: string[] };
type ApiResult =
  | { kind: "ok"; replies: string[]; links: string[]; video: string; poll: Poll | null }
  | { kind: "limited"; detail: string };
/** What a turn posts: a text to /api/imessage, or a vote to /api/imessage/vote. */
type Ask = { text: string } | { poll: string; option: string };

function pollOf(v: any): Poll | null {
  const q = typeof v?.question === "string" ? v.question.trim() : "";
  const opts = Array.isArray(v?.options) ? v.options.filter((o: unknown) => typeof o === "string" && o.trim() !== "") : [];
  return q && opts.length >= 2 ? { question: q, options: opts.slice(0, 4) } : null;
}

async function callApi(fromHash: string, ask: Ask, deps: RelayDeps): Promise<ApiResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (deps.secret) headers["x-relay-secret"] = deps.secret;
  const route = "text" in ask ? "/api/imessage" : "/api/imessage/vote";
  const res = await deps.fetch(`${deps.apiUrl.replace(/\/+$/, "")}${route}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ from_hash: fromHash, ...ask }),
    signal: AbortSignal.timeout(deps.timeoutMs ?? TIMEOUT_MS),
  });
  const body: any = await res.json().catch(() => null);
  if (res.status === 429) {
    const detail = typeof body?.detail === "string" ? body.detail.trim() : "";
    if (detail) return { kind: "limited", detail };
    throw new RelayError("http 429 without detail");
  }
  if (!res.ok) throw new RelayError(`http ${res.status}`);
  if (!body || !Array.isArray(body.replies)) throw new RelayError("bad reply shape");
  const replies = (body.replies as unknown[])
    .filter((r): r is string => typeof r === "string" && r.trim() !== "")
    .map((r) => r.trim())
    .slice(0, MAX_REPLIES);
  const links = (Array.isArray(body.links) ? body.links : [body.link])
    .filter((l: unknown): l is string => typeof l === "string" && l.trim() !== "")
    .map((l: string) => l.trim())
    .slice(0, 2);
  const video = typeof body.video_url === "string" && body.video_url.startsWith("/media/") ? body.video_url : "";
  if (!replies.length && !links.length) throw new RelayError("empty reply");
  return { kind: "ok", replies, links, video, poll: pollOf(body.poll) };
}

/** Error name or our own safe message. Never the raw message, which could echo user data. */
const describe = (e: unknown): string =>
  e instanceof RelayError ? e.message : e instanceof Error ? e.name : typeof e;

export const TYPING_TIMEOUT_MS = 3_000;

/** Best effort: errors are ignored and a hung call is abandoned after TYPING_TIMEOUT_MS. */
const quietly = async (fn: () => unknown) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(fn),
      new Promise((r) => (timer = setTimeout(r, TYPING_TIMEOUT_MS))),
    ]);
  } catch {
    /* best effort */
  } finally {
    clearTimeout(timer);
  }
};

async function fetchVideo(path: string, deps: RelayDeps): Promise<Uint8Array | null> {
  try {
    const res = await deps.fetch(`${deps.apiUrl.replace(/\/+$/, "")}${path}`, { signal: AbortSignal.timeout(60_000) });
    const len = Number(res.headers.get("content-length") ?? 0);
    if (!res.ok || len > MAX_VIDEO_BYTES) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    return bytes.length > 0 && bytes.length <= MAX_VIDEO_BYTES ? bytes : null;
  } catch {
    return null;
  }
}

export async function handleMessage(msg: IncomingLike, deps: RelayDeps): Promise<Outcome> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const v = votable(msg);
  if (v) {
    log(`[vote] ${hashSender(v.senderId).slice(0, 12)}`);
    return relayTurn(v.senderId, { poll: v.poll, option: v.option }, deps);
  }
  const m = relayable(msg);
  if (!m) return "ignored";
  const tag = hashSender(m.senderId).slice(0, 12);
  log(`[in] ${tag}`);
  // A spot shared after the wait ran out goes to the agent first, as the share page's turn would.
  const spot = deps.lateLocation ? await deps.lateLocation(m.senderId).catch(() => null) : null;
  if (spot) {
    log(`[loc] ${tag} shared late`);
    await relayTurn(m.senderId, { text: shopTurnText(spot) }, deps);
  }
  return relayTurn(m.senderId, { text: m.text }, deps);
}

/** One turn: post a text or a vote as `senderId`, then text back the replies, cards, video and poll. */
async function relayTurn(senderId: string, ask: Ask, deps: RelayDeps): Promise<Outcome> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const sleep = deps.sleep ?? defaultSleep;
  const gap = deps.gapMs ?? GAP_MS;
  const fromHash = hashSender(senderId);
  const tag = fromHash.slice(0, 12);
  const started = Date.now();
  const m = { senderId };

  let outgoing: string[];
  let links: string[] = [];
  let video = "";
  let poll: Poll | null = null;
  let outcome: Outcome;
  await quietly(() => deps.typing?.(true));
  try {
    const r = await callApi(fromHash, ask, deps);
    if (r.kind === "limited") {
      outgoing = [r.detail];
      outcome = "rate_limited";
    } else {
      outgoing = r.replies;
      links = r.links;
      video = r.video;
      poll = r.poll;
      outcome = "replied";
    }
  } catch (e) {
    log(`[err] ${tag} ${describe(e)}`);
    outgoing = [SORRY];
    outcome = "error";
  } finally {
    await quietly(() => deps.typing?.(false));
  }

  try {
    let n = 0;
    const pace = async () => {
      if (n++ > 0) await sleep(gap);
    };
    for (const t of outgoing) {
      await pace();
      await deps.send(t);
    }
    for (const l of links) {
      await pace();
      if (isShopLink(l) && deps.requestLocation) {
        const r = await deps.requestLocation(m.senderId).catch(() => "failed" as const);
        if (r === "sent" && deps.waitLocation) watchLocation(m.senderId, deps);
        if (r !== "failed") continue; // the request stands in for the share page card
        log(`[loc] ${tag} request failed, sending the share page`);
      }
      const layout = deps.sendCard ? await planCard(l, deps) : null;
      if (layout) {
        await deps.sendCard!(l, layout);
        continue;
      }
      await (deps.sendLink ? deps.sendLink(l) : deps.send(l));
    }
    if (video && deps.sendVideo) {
      const bytes = await fetchVideo(video, deps); // a missing or oversized video is skipped, not an error
      if (bytes) {
        await pace();
        await deps.sendVideo(bytes, video.split("/").pop() || "preview.mp4");
      }
    }
    if (poll && deps.sendPoll) {
      await pace();
      await deps.sendPoll(poll.question, poll.options);
    }
  } catch (e) {
    log(`[send-fail] ${tag} ${describe(e)}`);
    return "send_failed";
  }
  log(`[out] ${tag} ${outcome} texts=${outgoing.length} links=${links.length} video=${video ? 1 : 0} poll=${poll && deps.sendPoll ? 1 : 0} ${((Date.now() - started) / 1000).toFixed(1)}s`);
  return outcome;
}

/** Wait for the owner to share their spot, then hand it to the agent as the share page would. */
function watchLocation(senderId: string, deps: RelayDeps): void {
  const log = deps.log ?? ((line: string) => console.log(line));
  const tag = hashSender(senderId).slice(0, 12);
  const work = (async () => {
    const spot = await deps.waitLocation!(senderId).catch(() => null);
    if (!spot) return log(`[loc] ${tag} not shared`);
    log(`[loc] ${tag} shared`);
    await relayTurn(senderId, { text: shopTurnText(spot) }, deps);
  })();
  (deps.background ?? ((p) => void p.catch(() => {})))(work);
}
