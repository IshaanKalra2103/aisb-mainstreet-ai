/** The site's public origin: link cards need absolute URLs. */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://mainstreet-ai-five.vercel.app";

/**
 * og:video for a page: a looping 1200x630 mp4 from public/og (made by scripts/og_loops.py). iMessage plays it muted
 * and looping in place of the still link card. Next resolves og:image against metadataBase but not og:video, so the
 * URL is absolute here.
 */
export function ogVideo(name: string) {
  const url = new URL(`/og/${name}.mp4`, SITE_URL).href;
  return [{ url, secureUrl: url, type: "video/mp4", width: 1200, height: 630 }];
}
