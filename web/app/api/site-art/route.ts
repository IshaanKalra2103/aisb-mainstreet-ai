import type { NextRequest } from "next/server";
import { MIME, normalizeSite, siteArt } from "@/lib/siteart";

export const maxDuration = 30;

// Served from our origin, so an svg logo must not run anything if opened directly.
const SAFE = { "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" };
const no = (status: number, text: string) => new Response(text, { status, headers: { "cache-control": "public, max-age=3600", ...SAFE } });

/** GET /api/site-art?site=<website>&kind=photo|logo[&n=0-3]: the shop's own photo (n-th best) or logo, from its site. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const kind = q.get("kind") ?? "photo";
  const n = q.get("n") ?? "0";
  if (kind !== "photo" && kind !== "logo") return no(400, "kind is photo or logo.");
  if (!/^[0-3]$/.test(n)) return no(400, "n is 0 to 3.");
  const site = normalizeSite(q.get("site"));
  if (!site) return no(400, "Give the shop's public website.");
  const art = await siteArt(site);
  // Fewer photos than cards: the n-th card wraps round to one we have, so every card shows the shop.
  const pick = kind === "logo" ? art.logo : art.photos[Number(n) % Math.max(1, art.photos.length)];
  if (!pick) return no(404, "Nothing usable on that site.");
  return new Response(new Uint8Array(pick.body), {
    headers: { "content-type": MIME[pick.type], "cache-control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400", ...SAFE },
  });
}
