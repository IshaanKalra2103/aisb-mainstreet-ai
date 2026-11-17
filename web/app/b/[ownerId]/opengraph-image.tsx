import { ImageResponse } from "next/og";
import { connection } from "next/server";
import type { OwnerBundle } from "@/lib/types";
import { demoBundles } from "@/data/demo";
import { BUSINESS_TYPE_LABELS } from "@/lib/catalog";
import { AGENT_URL } from "@/lib/api";
import { streetPhoto } from "@/lib/streetview";
import { BG, Brand, Chip, INK, OG_SIZE, jpegUri, mapImage, ogFonts, publicImage } from "@/lib/og";

// The card iMessage shows for an owner's page: their street, their name, and what the plan gives back.
export const alt = "Your MainStreet AI plan";
export const size = OG_SIZE;
export const contentType = "image/png";

async function liveBundle(ownerId: string): Promise<OwnerBundle | null> {
  if (!AGENT_URL || !/^o_[a-z0-9]{6,32}$/.test(ownerId)) return null;
  try {
    const r = await fetch(`${AGENT_URL}/api/owners/${ownerId}`, { signal: AbortSignal.timeout(3000), cache: "no-store" });
    return r.ok ? ((await r.json()) as OwnerBundle) : null;
  } catch {
    return null;
  }
}

export default async function Image({ params }: { params: Promise<{ ownerId: string }> }) {
  const { ownerId } = await params;
  const slug = ownerId.startsWith("demo-") ? ownerId.slice(5) : null;
  let bundle: OwnerBundle | null = slug ? demoBundles[slug] ?? null : null;
  let photo: string | null = null;
  if (slug && bundle) {
    photo = await publicImage(`places/${slug}/hero.jpg`);
  } else if (!slug) {
    await connection(); // a live owner's plan changes: draw it when asked
    bundle = await liveBundle(ownerId);
    const p = bundle?.profile;
    const place = p?.lat != null && p?.lon != null ? { lat: p.lat, lon: p.lon } : p?.city ? { q: `${p.city}, ${p.state}` } : null;
    const bytes = place ? await streetPhoto(place, 0).catch(() => null) : null;
    if (bytes) photo = jpegUri(bytes);
  }
  const p = bundle?.profile;
  const items = bundle?.needs?.items ?? [];
  const hours = Math.round(items.reduce((s, n) => s + n.est_hours_saved_week, 0));
  const kind = p ? `${BUSINESS_TYPE_LABELS[p.business_type] ?? "Small business"} · ${p.city}, ${p.state}` : "Small business AI plan";
  const name = p?.name ?? "Your MainStreet page";
  const bg = photo ?? (await mapImage());

  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", background: BG, position: "relative" }}>
        <img src={bg} width={1200} height={750} style={{ position: "absolute", left: 0, top: -60, width: 1200, height: 750, objectFit: "cover" }} />
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex",
          background: "linear-gradient(90deg, rgba(20,21,24,0.96) 0%, rgba(20,21,24,0.86) 38%, rgba(20,21,24,0.35) 70%, rgba(20,21,24,0.1) 100%)" }} />
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", background: "linear-gradient(0deg, rgba(20,21,24,0.7) 0%, rgba(20,21,24,0) 40%)" }} />
        <div style={{ position: "absolute", left: 72, top: 64, bottom: 64, width: 760, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <Brand />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontFamily: "Source", fontWeight: 600, fontSize: 28, letterSpacing: 2.5, color: "rgba(244,244,242,0.72)", textTransform: "uppercase" }}>{kind}</div>
            <div style={{ fontFamily: "Fraunces", fontWeight: 600, fontSize: name.length > 26 ? 70 : 84, lineHeight: 1.02, color: INK, marginTop: 14, letterSpacing: -1.5 }}>{name}</div>
          </div>
          <div style={{ display: "flex" }}>
            {items.length > 0
              ? <><Chip lime>{`${hours} hours back a week`}</Chip><Chip>{`${items.length} jobs for AI`}</Chip></>
              : <Chip lime>See your plan</Chip>}
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: await ogFonts() },
  );
}
