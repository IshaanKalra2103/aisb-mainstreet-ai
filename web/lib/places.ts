import type { Profile } from "./types";

/** How many job photos each example business has in public/places/<slug>/ (job-1.jpg ... job-n.jpg). */
const DEMO_JOBS: Record<string, number> = { coffee: 4, diner: 3, hvac: 3, landscaping: 4, salon: 4 };

export function demoPhoto(slug: string): string | null {
  return DEMO_JOBS[slug] ? `/places/${slug}/hero.jpg` : null;
}

/**
 * A Street View photo of the shop's street. View 0 faces the shop; view n is the n-th job card's angle on the same
 * street. Example businesses use the photos saved in public/places; live owners go through /api/street, which keeps
 * the Maps key on the server. Null when we know nothing about where the shop is.
 */
export function placePhoto(ownerId: string, profile: Profile | null | undefined, view = 0): string | null {
  if (ownerId.startsWith("demo-")) {
    const slug = ownerId.slice(5);
    const n = DEMO_JOBS[slug];
    if (!n) return null;
    return view === 0 ? `/places/${slug}/hero.jpg` : `/places/${slug}/job-${((view - 1) % n) + 1}.jpg`;
  }
  if (!profile) return null;
  const q = new URLSearchParams();
  if (profile.lat != null && profile.lon != null) {
    q.set("lat", profile.lat.toFixed(5));
    q.set("lon", profile.lon.toFixed(5));
  } else if (profile.city) {
    q.set("q", [profile.city, profile.state].filter(Boolean).join(", "));
  } else {
    return null;
  }
  if (view) q.set("view", String(view));
  return `/api/street?${q}`;
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
 * whose ids hash differently get different shots), else null, and the card falls back to the street.
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
