import type { Metadata } from "next";
import { DEMO_BUSINESSES, demoBundles } from "@/data/demo";
import StreetTile from "@/components/StreetTile";

export const metadata: Metadata = { title: "Example businesses" };

/** "4 jobs for AI · 6 hours back a week" from an example's saved plan. */
function statsOf(slug: string): string | undefined {
  const items = demoBundles[slug]?.needs?.items ?? [];
  if (!items.length) return undefined;
  const hours = Math.round(items.reduce((s, n) => s + n.est_hours_saved_week, 0));
  return `${items.length} jobs for AI · ${hours} hours back a week`;
}

export default function DemoPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <h1 className="text-4xl sm:text-5xl font-semibold">Five example businesses</h1>
      <p className="mt-3 max-w-2xl text-soft">
        These are made-up businesses on real Maryland main streets. Open one to see what we found, which tools we compared, and what a finished setup looks like.
      </p>
      <ul className="mt-8 grid gap-5 sm:grid-cols-2">
        {DEMO_BUSINESSES.map((b) => (
          <li key={b.slug} className={demoBundles[b.slug] ? "" : "pointer-events-none opacity-60"}>
            <StreetTile big slug={b.slug} name={b.name} place={b.place} kind={b.kind}
              stats={demoBundles[b.slug] ? statsOf(b.slug) : "Coming soon"} />
          </li>
        ))}
      </ul>
    </div>
  );
}
