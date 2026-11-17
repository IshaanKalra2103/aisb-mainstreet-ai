import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import BusinessView from "@/components/BusinessView";
import { demoBundles } from "@/data/demo";
import { APP_NAME } from "@/lib/brand";
import { ogVideo } from "@/lib/ogVideo";

// The iMessage card for the owner's link: og:title under the big image (opengraph-image.tsx draws a photo of the shop).
// A live owner's name is in the image; the title stays generic so the page never waits on the agent to render it.
export async function generateMetadata({ params }: PageProps<"/b/[ownerId]">): Promise<Metadata> {
  const { ownerId } = await params;
  const p = ownerId.startsWith("demo-") ? demoBundles[ownerId.slice(5)]?.profile : null;
  const title = p?.name ?? "Your AI plan";
  const description = p ? `What AI can take off the plate at ${p.name} in ${p.city}, ${p.state}, and which tools we checked.`
    : "The jobs AI can take off your plate, the tools we checked, and what we set up for you.";
  // The link plays as a short loop in iMessage: an example's shop front and its AI preview, or the examples' montage.
  const videos = ogVideo(p ? ownerId : "home");
  return { title, description, openGraph: { title, description, siteName: APP_NAME, type: "video.other", videos } };
}

export function generateStaticParams() {
  return Object.keys(demoBundles).map((slug) => ({ ownerId: `demo-${slug}` }));
}

export default async function Page({ params }: PageProps<"/b/[ownerId]">) {
  const { ownerId } = await params;
  if (ownerId.startsWith("demo-")) {
    const bundle = demoBundles[ownerId.slice(5)];
    if (!bundle) notFound();
    return (
      <Suspense>
        <BusinessView ownerId={ownerId} demo={bundle} />
      </Suspense>
    );
  }
  return (
    <Suspense>
      <BusinessView ownerId={ownerId} />
    </Suspense>
  );
}
