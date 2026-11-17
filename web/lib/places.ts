import type { Profile } from "./types";

/** The example businesses: their sites have no photos, so each has a stock photo of that kind of shop in
 * public/shops/<slug>.jpg (Pexels; credits.json beside them). Never a street view: that shows the street, not the shop. */
const DEMO_SHOPS = new Set(["coffee", "diner", "hvac", "landscaping", "salon"]);

/** Sites that aren't the shop's own (a listing or social page): their pictures are the platform's, not the shop's. */
const NOT_OWN = /(^|\.)(google\.[a-z.]+|goo\.gl|facebook\.com|instagram\.com|yelp\.com|tripadvisor\.[a-z.]+|doordash\.com|ubereats\.com|grubhub\.com|linktr\.ee|tiktok\.com|x\.com|twitter\.com)$/i;

/** The shop's own website from its profile, as an https URL, or null when it has none of its own. */
export function ownSite(website: string | null | undefined): string | null {
  const s = website?.trim();
  if (!s) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return NOT_OWN.test(u.hostname) ? null : u.href;
  } catch {
    return null;
  }
}

/** The shop's logo, taken from its own website. Null without one (and for the example businesses). */
export function siteLogo(ownerId: string, profile: Profile | null | undefined): string | null {
  const site = ownerId.startsWith("demo-") ? null : ownSite(profile?.website);
  return site ? `/api/site-art?${new URLSearchParams({ site, kind: "logo" })}` : null;
}

/**
 * A photo of the shop. View 0 is the main one; view n is the n-th job card's. Example businesses use their photo in
 * public/shops; live owners get photos from their own website through /api/site-art. Null without a website.
 */
export function placePhoto(ownerId: string, profile: Profile | null | undefined, view = 0): string | null {
  if (ownerId.startsWith("demo-")) {
    const slug = ownerId.slice(5);
    return DEMO_SHOPS.has(slug) ? `/shops/${slug}.jpg` : null;
  }
  const site = ownSite(profile?.website);
  if (!site) return null;
  // v: bump when the photo picker changes, so browsers and the CDN drop the photos they cached from the old one.
  const q = new URLSearchParams({ site, kind: "photo", v: "2" });
  if (view) q.set("n", String(view % 4));
  return `/api/site-art?${q}`;
}

/** Stock photos of each kind of job, in public/jobs/<need_id>.jpg (Pexels; credits.json beside them). Value: how many shots. */
const JOB_PHOTOS: Record<string, number> = {
  "website-chat": 2, "social-posts": 2, reviews: 2, "missed-calls": 2,
  booking: 1, books: 1, quotes: 1, "marketing-msgs": 1, "menu-inventory": 1,
};

/** Photos found for each example business's own jobs, in public/jobs/<slug>/<need_id>.jpg. */
const DEMO_JOB_PHOTOS: Record<string, string[]> = {
  coffee: ["social-posts", "website-chat", "reviews", "marketing-msgs"],
  diner: ["website-chat", "reviews", "social-posts"],
  hvac: ["missed-calls", "quotes", "books"],
  landscaping: ["books", "missed-calls", "quotes", "reviews"],
  salon: ["booking", "reviews", "marketing-msgs", "social-posts"],
};

/**
 * A photo of the job being done: the example business's own photo, else a stock photo of that kind of job (owners
 * whose ids hash differently get different shots), else null, and the card falls back to a photo of the shop.
 */
export function jobPhoto(ownerId: string, needId: string): string | null {
  const slug = ownerId.startsWith("demo-") ? ownerId.slice(5) : "";
  if (DEMO_JOB_PHOTOS[slug]?.includes(needId)) return `/jobs/${slug}/${needId}.jpg`;
  const shots = JOB_PHOTOS[needId];
  if (!shots) return null;
  const pick = [...ownerId].reduce((h, ch) => h + ch.charCodeAt(0), 0) % shots;
  return `/jobs/${needId}${pick ? `-${pick + 1}` : ""}.jpg`;
}

/** Favicon of the tool's site, the logo we show next to its name. */
export function toolLogo(url: string): string | null {
  try {
    return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=64`;
  } catch {
    return null;
  }
}
