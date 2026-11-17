import { ImageResponse } from "next/og";
import { BG, Brand, Chip, INK, LIME, OG_SIZE, PinGlyph, mapImage, ogFonts } from "@/lib/og";

// The card iMessage shows for the share link: a dark street map with a lime pin.
export const alt = "Share your shop: your location and one link, two taps.";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image() {
  const map = await mapImage();
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", background: BG, position: "relative" }}>
        <img src={map} width={1200} height={720} style={{ position: "absolute", left: 0, top: -40, width: 1200, height: 720, objectFit: "cover" }} />
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex",
          background: "linear-gradient(90deg, rgba(28,29,34,0.97) 0%, rgba(28,29,34,0.88) 40%, rgba(28,29,34,0.25) 75%, rgba(28,29,34,0.55) 100%)" }} />
        {/* the pin, with two rings like a location ping */}
        <div style={{ position: "absolute", left: 830, top: 215, width: 200, height: 200, borderRadius: 999, display: "flex",
          alignItems: "center", justifyContent: "center", border: `3px solid rgba(215,255,58,0.35)` }}>
          <div style={{ width: 150, height: 150, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(215,255,58,0.16)" }}>
            <div style={{ width: 104, height: 104, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center",
              background: LIME, boxShadow: "0 18px 40px rgba(0,0,0,0.5)" }}>
              <PinGlyph size={56} />
            </div>
          </div>
        </div>
        <div style={{ position: "absolute", left: 72, top: 64, bottom: 64, width: 640, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <Brand />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontFamily: "Fraunces", fontWeight: 600, fontSize: 92, lineHeight: 1.02, color: INK, letterSpacing: -1.5 }}>Share your shop</div>
            <div style={{ fontFamily: "Source", fontSize: 34, color: "rgba(244,244,242,0.78)", marginTop: 18, lineHeight: 1.3 }}>
              Your location and one link, so your plan uses real facts. Two taps.
            </div>
          </div>
          <div style={{ display: "flex" }}><Chip lime>Tap to share</Chip><Chip>About 10 seconds</Chip></div>
        </div>
      </div>
    ),
    { ...size, fonts: await ogFonts() },
  );
}
