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

/** Favicon of the tool's site, the logo we show next to its name. */
export function toolLogo(url: string): string | null {
  try {
    return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=64`;
  } catch {
    return null;
  }
}
