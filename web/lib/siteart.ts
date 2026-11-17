/**
 * The shop's own pictures from its website: a few photos and its logo. Server only.
 *
 * We read the home page and take its sharing image (og:image) unless it's blank, then the big JPEGs on the page in
 * order, plus its logo. Sizes come from the file header; "blank" means few bytes per pixel. Every address a site
 * resolves to is checked when we connect, so the route can't be pointed at our own network.
 */
import { lookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";

export type ImageType = "jpeg" | "png" | "gif" | "webp" | "svg";
export type ImageInfo = { type: ImageType; width: number; height: number };
export type Picture = { type: ImageType; body: Buffer };
export type SiteArt = { photos: Picture[]; logo: Picture | null };
export const MIME: Record<ImageType, string> = { jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" };

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

// ---------------------------------------------------------------- only public sites

const PRIVATE = new BlockList();
for (const [net, bits] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3]] as const) PRIVATE.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [["::", 127], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const) PRIVATE.addSubnet(net, bits, "ipv6");

/** True only for an address on the public internet (IPv4-mapped IPv6 is checked as the IPv4 inside). */
export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip);
  return kind !== 0 && !PRIVATE.check(ip, kind === 6 ? "ipv6" : "ipv4");
}

function allowed(u: URL): boolean {
  if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password || u.port) return false;
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(host)) return isPublicAddress(host);
  return host.includes(".") && !/(^|\.)(localhost|local|internal)\.?$/.test(host);
}

/** The shop's website as an http(s) URL on the usual ports, or null. "vigilantecoffee.com" becomes https://. */
export function normalizeSite(input: unknown): URL | null {
  if (typeof input !== "string" || !input.trim()) return null;
  const s = input.trim();
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
    u.hash = "";
    return allowed(u) ? u : null;
  } catch {
    return null;
  }
}

function guardedLookup(host: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) {
  lookup(host, { ...opts, all: true }, (err, addrs) => {
    const list = addrs as unknown as LookupAddress[];
    if (err || !list.length || list.some((a) => !isPublicAddress(a.address))) return cb(err ?? new Error("private address"));
    return opts?.all ? cb(null, list) : cb(null, list[0].address, list[0].family);
  });
}

function getOnce(u: URL, accept: string, max: number): Promise<{ body?: Buffer; location?: string }> {
  return new Promise((resolve) => {
    const req = (u.protocol === "https:" ? https : http).get(u, {
      agent: false, lookup: guardedLookup as never, timeout: 6000,
      headers: { "user-agent": UA, accept, "accept-encoding": "identity" },
    }, (res) => {
      const s = res.statusCode ?? 0;
      if (s >= 300 && s < 400) return res.resume(), resolve({ location: res.headers.location });
      if (s !== 200 || Number(res.headers["content-length"]) > max) return res.destroy(), resolve({});
      const chunks: Buffer[] = [];
      let n = 0;
      res.on("data", (c: Buffer) => ((n += c.length) > max ? (res.destroy(), resolve({})) : chunks.push(c)));
      res.on("end", () => resolve({ body: Buffer.concat(chunks) }));
      res.on("error", () => resolve({}));
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve({}));
  });
}

/** GET a public URL, following up to 4 redirects (each one checked). Null on any failure. */
export async function safeFetch(u: URL, accept: string, max: number): Promise<{ url: URL; body: Buffer } | null> {
  for (let hop = 0; hop < 5 && allowed(u); hop++) {
    const got = await getOnce(u, accept, max);
    if (got.body) return { url: u, body: got.body };
    if (!got.location) return null;
    try {
      u = new URL(got.location, u);
    } catch {
      return null;
    }
  }
  return null;
}

// ---------------------------------------------------------------- reading the page

const attrs = (s: string) => {
  const o: Record<string, string> = {};
  for (const m of s.matchAll(/([^\s"'=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>]+))/g)) {
    o[m[1].toLowerCase()] ??= (m[2] ?? m[3] ?? m[4]).replace(/&amp;/g, "&");
  }
  return o;
};

/** The biggest image in a srcset ("a.jpg 400w, b.jpg 1600w"). */
function largest(srcset?: string): string | undefined {
  let best: string | undefined, bw = -1;
  for (const m of (srcset ?? "").matchAll(/(\S+)\s+(\d+)w/g)) if (+m[2] > bw) [bw, best] = [+m[2], m[1].replace(/^,+/, "")];
  return best;
}

function absolute(raw: string | undefined, base: URL, photo: boolean): string | null {
  const s = raw?.trim();
  if (!s || s.includes("{{") || /^(data|blob):/i.test(s)) return null;
  try {
    const u = new URL(s.replace(/\{width\}/g, "1600"), base);
    if (u.protocol === "http:" && u.hostname === base.hostname) u.protocol = base.protocol;
    // Shopify serves any size from the same file name: ask for a big one instead of the page's thumbnail.
    if (photo && u.pathname.includes("/cdn/shop/")) u.pathname = u.pathname.replace(/_\d*x\d*(_crop_[a-z]+)?(\.\w+)$/i, "_1600x$2");
    return u.href;
  } catch {
    return null;
  }
}

/** Interface graphics, not photos. */
const CHROME = /\.(svg|ico|gif)(\?|$)|(?<![a-z])(icons?|sprites?|spinner|placeholder|payments?|arrows?|avatars?|badges?|stars?)(?![a-z])/i;

/** The page's images as absolute URLs: og (sharing images), logos (marked "logo", then structured data, then the
 * touch icon) and photos (og first, then images and backgrounds in page order). */
export function findArt(html: string, baseHref: string) {
  const base = new URL(baseHref);
  const og: string[] = [], logos: string[] = [], page: string[] = [], late: string[] = [];
  const add = (list: string[], raw: string | undefined, photo: boolean) => {
    const u = absolute(raw, base, photo);
    if (u && !list.includes(u)) list.push(u);
  };
  for (const m of html.matchAll(/"logo"\s*:\s*(?:\{[^}]*?"url"\s*:\s*)?"([^"]+)"/g)) add(late, m[1].replace(/\\\//g, "/"), false);
  const doc = html.replace(/<!--[\s\S]*?-->|<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>/gi, " ");
  for (const m of doc.matchAll(/<(meta|link|img|source|div|section)\b([^>]*)>/gi)) {
    const tag = m[1].toLowerCase(), a = attrs(m[2]);
    if (tag === "meta" && /^(og:image(:secure_url)?|twitter:image)$/.test(a.property ?? a.name ?? "")) add(og, a.content, true);
    else if (tag === "link" && /apple-touch-icon/.test(a.rel ?? "")) add(late, a.href, false);
    else if (tag === "img" || tag === "source") {
      const src = largest(a["data-srcset"] || a.srcset) ?? a["data-src"] ?? a.src;
      if (/logo/i.test(`${a.class} ${a.id} ${a.alt} ${a.itemprop} ${src}`)) add(logos, src, false);
      else if (src && !CHROME.test(src) && !(+a.width < 300)) add(page, src, true);
    } else {
      const bg = /background(?:-image)?\s*:[^;]*url\(\s*['"]?([^'")]+)/i.exec(a.style ?? "")?.[1];
      if (bg && !CHROME.test(bg)) add(page, bg, true);
    }
  }
  const allLogos = [...new Set([...logos, ...late])];
  return { og, logos: allLogos, photos: [...new Set([...og, ...page])].filter((u) => !allLogos.includes(u)) };
}

// ---------------------------------------------------------------- judging images

/** Type and pixel size from an image file's header (svg has no fixed size), or null if it isn't an image. */
export function imageInfo(b: Uint8Array): ImageInfo | null {
  const u16 = (i: number) => (b[i] << 8) | b[i + 1];
  const u32 = (i: number) => (u16(i) << 16 >>> 0) + u16(i + 2);
  const is = (i: number, s: string) => [...s].every((ch, k) => b[i + k] === ch.charCodeAt(0));
  if (b[0] === 0x89 && is(1, "PNG")) return { type: "png", width: u32(16), height: u32(20) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 8 < b.length; i += 2 + u16(i + 2)) {
      const m = b[i + 1];
      if (b[i] !== 0xff || m === 0xda) break;
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { type: "jpeg", width: u16(i + 7), height: u16(i + 5) };
    }
    return null;
  }
  if (is(0, "GIF8")) return { type: "gif", width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8) };
  if (is(0, "RIFF") && is(8, "WEBP")) {
    if (is(12, "VP8X")) return { type: "webp", width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    if (is(12, "VP8 ")) return { type: "webp", width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
    if (is(12, "VP8L")) return { type: "webp", width: 1 + (u16le(b, 21) & 0x3fff), height: 1 + (((b[22] >> 6) | (b[23] << 2) | (b[24] << 10)) & 0x3fff) };
    return null;
  }
  return /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(Buffer.from(b.subarray(0, 1024)).toString("utf8")) ? { type: "svg", width: 0, height: 0 } : null;
}

const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);

/** Fewer bytes per pixel than this is a flat graphic (a logo on white), not a photo. */
const FLAT: Record<ImageType, number> = { jpeg: 0.06, webp: 0.04, png: 0.15, gif: 9, svg: 9 };

/** Big enough to show, not a sliver, and not blank. */
export function isPhoto(info: ImageInfo, bytes: number): boolean {
  const aspect = info.width / info.height;
  return info.width >= 500 && info.height >= 280 && aspect >= 0.75 && aspect <= 3.2 && bytes / (info.width * info.height) >= FLAT[info.type];
}

type Found = { url: string; info: ImageInfo; bytes: number };

/** The sharing image unless it's blank, then the big JPEGs on the page in order (PNGs there are mostly product
 * cut-outs), at most four. */
export function pickPhotos<T extends Found>(found: (T | null)[], og: string[]): T[] {
  return found.filter((f): f is T => !!f && isPhoto(f.info, f.bytes) && (og.includes(f.url) || f.info.type === "jpeg")).slice(0, 4);
}

// ---------------------------------------------------------------- the whole site

const IMAGE_ACCEPT = "image/jpeg,image/png,image/svg+xml;q=0.8,*/*;q=0.5"; // JPEG/PNG: what link cards can show

async function getImage(href: string, max: number) {
  const r = await safeFetch(new URL(href), IMAGE_ACCEPT, max);
  const info = r && imageInfo(r.body);
  return info ? { type: info.type, body: r!.body, info } : null;
}

async function gather(site: URL): Promise<SiteArt> {
  const home = await safeFetch(site, "text/html", 2_000_000);
  if (!home) return { photos: [], logo: null };
  const art = findArt(home.body.toString("utf8"), home.url.href);
  const [found, logo] = await Promise.all([
    Promise.all(art.photos.slice(0, 10).map(async (url) => {
      const img = await getImage(url, 8_000_000);
      return img && { url, info: img.info, bytes: img.body.length, type: img.type, body: img.body };
    })),
    (async () => {
      for (const u of art.logos.slice(0, 3)) {
        const img = await getImage(u, 1_000_000);
        if (img && (img.type === "svg" || img.info.width >= 40)) return { type: img.type, body: img.body };
      }
      return null;
    })(),
  ]);
  return { photos: pickPhotos(found, art.og).map(({ type, body }) => ({ type, body })), logo };
}

const cache = new Map<string, Promise<SiteArt>>();

/** The site's photos (up to 4) and its logo, kept in memory. Never throws. */
export function siteArt(site: URL): Promise<SiteArt> {
  let art = cache.get(site.href);
  if (!art) {
    art = gather(site).catch(() => ({ photos: [], logo: null }));
    cache.set(site.href, art);
    if (cache.size > 200) cache.delete(cache.keys().next().value!);
  }
  return art;
}
