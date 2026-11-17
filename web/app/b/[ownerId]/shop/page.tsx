import type { Metadata } from "next";
import { Suspense } from "react";
import ShopShare from "@/components/ShopShare";
import { demoBundles } from "@/data/demo";
import { APP_NAME } from "@/lib/brand";

const TITLE = "Share your shop";
const DESCRIPTION = "Two taps, so your plan uses real facts about your shop.";

// openGraph is set here too: pages inherit the layout's openGraph ("MainStreet AI") unless they set their own,
// and the iMessage card reads og:title first.
export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, siteName: APP_NAME, type: "website" },
};

export function generateStaticParams() {
  return Object.keys(demoBundles).map((slug) => ({ ownerId: `demo-${slug}` }));
}

export default async function Page({ params }: PageProps<"/b/[ownerId]/shop">) {
  const { ownerId } = await params;
  return (
    <Suspense>
      <ShopShare ownerId={ownerId} />
    </Suspense>
  );
}
