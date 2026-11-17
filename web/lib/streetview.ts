const SV = "https://maps.googleapis.com/maps/api/streetview";
/** View n turns the camera from the shop front: along the street both ways, then across it; 4+ adds 45 degrees. */
const TURN = [0, 90, -90, 180];

export type Place = { lat: number; lon: number } | { q: string };

function bearing(from: { lat: number; lng: number }, to: { lat: number; lon: number }): number {
  const r = Math.PI / 180;
  const y = Math.sin((to.lon - from.lng) * r) * Math.cos(to.lat * r);
  const x = Math.cos(from.lat * r) * Math.sin(to.lat * r) - Math.sin(from.lat * r) * Math.cos(to.lat * r) * Math.cos((to.lon - from.lng) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}

/**
 * JPEG bytes of a Street View photo at a place, or null when there is no Google-taken panorama within 80 m. The
 * metadata call is free; only the photo is billed.
 */
export async function streetPhoto(place: Place, view = 0, size = "640x400"): Promise<ArrayBuffer | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  const location = "q" in place ? place.q : `${place.lat.toFixed(5)},${place.lon.toFixed(5)}`;
  // source=google: only Google's own car photos. "outdoor" still returns photospheres people uploaded inside shops.
  const meta = await fetch(`${SV}/metadata?${new URLSearchParams({ location, radius: "80", source: "google", key })}`, { signal: AbortSignal.timeout(4000) })
    .then((r) => r.json())
    .catch(() => null);
  if (meta?.status !== "OK" || !String(meta.copyright ?? "").includes("Google") || !meta.pano_id) return null;
  const q = new URLSearchParams({ size, fov: "80", pitch: "4", key });
  if (view === 0 && "q" in place) {
    // A place name: let Street View face the camera towards it.
    q.set("location", location);
    q.set("radius", "80");
    q.set("source", "google");
  } else {
    const base = "q" in place ? 0 : bearing(meta.location, place);
    q.set("pano", meta.pano_id);
    q.set("heading", String(Math.round((base + TURN[view % 4] + (view >= 4 ? 45 : 0) + 360) % 360)));
  }
  const r = await fetch(`${SV}?${q}`, { signal: AbortSignal.timeout(6000) }).catch(() => null);
  if (!r?.ok || !r.headers.get("content-type")?.startsWith("image/")) return null;
  return r.arrayBuffer();
}

/** Read a place from ?lat=&lon= or ?q=; null when neither is usable. */
export function placeFrom(p: URLSearchParams): Place | null {
  const lat = Number(p.get("lat"));
  const lon = Number(p.get("lon"));
  if (p.has("lat") && p.has("lon") && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
    return { lat, lon };
  }
  const q = (p.get("q") ?? "").trim().slice(0, 120);
  return q ? { q } : null;
}
