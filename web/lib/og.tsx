import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Shared parts of the link-card images (opengraph-image routes). iMessage shows a big card for a 1200x630 image.
export const OG_SIZE = { width: 1200, height: 630 };
export const INK = "#f4f4f2";
export const LIME = "#d7ff3a";
export const LIME_INK = "#15160f";
export const BG = "#1c1d22";

// Literal paths, so the files are traced into the server bundle for the card drawn at request time.
export async function ogFonts() {
  const [display, ui, uiBold] = await Promise.all([
    readFile(join(process.cwd(), "assets/fonts/Fraunces-600.ttf")),
    readFile(join(process.cwd(), "assets/fonts/SourceSans3-400.ttf")),
    readFile(join(process.cwd(), "assets/fonts/SourceSans3-600.ttf")),
  ]);
  return [
    { name: "Fraunces", data: display, weight: 600 as const, style: "normal" as const },
    { name: "Source", data: ui, weight: 400 as const, style: "normal" as const },
    { name: "Source", data: uiBold, weight: 600 as const, style: "normal" as const },
  ];
}

/** A file under public/ as a data URI, for <img> inside ImageResponse. */
export async function publicImage(path: string, type = "image/jpeg"): Promise<string> {
  return `data:${type};base64,${(await readFile(join(process.cwd(), "public", path))).toString("base64")}`;
}

/** The dark street map (public/places/map.jpg), the backdrop when there is no photo of the shop. */
export async function mapImage(): Promise<string> {
  return `data:image/jpeg;base64,${(await readFile(join(process.cwd(), "public/places/map.jpg"))).toString("base64")}`;
}

export function jpegUri(bytes: ArrayBuffer): string {
  return `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`;
}

export function Brand() {
  return (
    <div style={{ display: "flex", alignItems: "center", fontFamily: "Source", fontWeight: 600, fontSize: 30, color: INK }}>
      MainStreet AI
      <div style={{ width: 10, height: 10, borderRadius: 999, background: LIME, marginLeft: 8 }} />
    </div>
  );
}

export function Chip({ children, lime }: { children: React.ReactNode; lime?: boolean }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", height: 56, padding: "0 26px", borderRadius: 999, fontFamily: "Source", fontWeight: 600,
      fontSize: 28, background: lime ? LIME : "rgba(255,255,255,0.14)", color: lime ? LIME_INK : INK, marginRight: 14,
    }}>{children}</div>
  );
}

export function PinGlyph({ size = 56, color = LIME_INK }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" />
      <path d="M17.657 16.657l-4.243 4.243a2 2 0 0 1 -2.827 0l-4.244 -4.243a8 8 0 1 1 11.314 0z" />
    </svg>
  );
}
