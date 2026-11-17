import type { NextRequest } from "next/server";
import { placeFrom, streetPhoto } from "@/lib/streetview";

/** GET /api/street?lat=&lon=[&view=n] or ?q=<city, state>: a Street View photo of the shop's street (the key stays here). */
export async function GET(req: NextRequest) {
  const place = placeFrom(req.nextUrl.searchParams);
  if (!place) return new Response("Give lat and lon, or q.", { status: 400 });
  const view = Math.max(0, Math.min(7, Math.trunc(Number(req.nextUrl.searchParams.get("view")) || 0)));
  const photo = await streetPhoto(place, view);
  if (!photo) return new Response("No street photo here.", { status: 404, headers: { "cache-control": "public, max-age=3600" } });
  return new Response(photo, {
    headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=86400, s-maxage=2592000, stale-while-revalidate=86400" },
  });
}
