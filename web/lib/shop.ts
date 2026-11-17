/** The share page's turn text. Its shape is a contract with the agent's intake skill (sandbox/.claude/skills/intake). */

export type ShopLocation = { lat: number; lon: number; acc: number };

/** A link as the owner typed it -> an http(s) URL, or null. "mainstreetshears.com" becomes "https://mainstreetshears.com". */
export function normalizeLink(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname.includes(".")) return null;
    return withScheme;
  } catch {
    return null;
  }
}

/**
 * `Here is my shop. Location: <lat>, <lon> (within <m> m). Link: <url>` (or `Location: not shared.`, `Link: none`).
 * The link comes last so no full stop sits against the URL. The radius is rounded up and never 0 (an emulated or
 * very good fix reports 0, which reads as "exact").
 */
export function shopTurnText(link: string | null, loc: ShopLocation | null): string {
  const where = loc
    ? `Location: ${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)} (within ${Math.max(1, Math.ceil(loc.acc))} m).`
    : "Location: not shared.";
  return `Here is my shop. ${where} Link: ${link ?? "none"}`;
}
