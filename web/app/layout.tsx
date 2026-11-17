import type { Metadata } from "next";
import { Fraunces, Source_Sans_3 } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import "./graphite.css";
import "./onboarding.css";
import { APP_NAME, TAGLINE } from "@/lib/brand";
import MascotLogo from "@/components/MascotLogo";
import NavLinks from "@/components/NavLinks";
import TextUsPass from "@/components/TextUsPass";
import { SITE_URL, ogVideo } from "@/lib/ogVideo";

const fraunces = Fraunces({ variable: "--font-fraunces", subsets: ["latin"] });
const source = Source_Sans_3({ variable: "--font-source", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s | ${APP_NAME}` },
  description: TAGLINE,
  openGraph: {
    title: APP_NAME, description: TAGLINE, siteName: APP_NAME, type: "video.other",
    // The mascot's 6 s idle loop (web/public/og/mascot.mp4): links to the site play it inline in iMessage.
    images: [{ url: "/og/mascot.jpg", width: 1200, height: 630 }], videos: ogVideo("mascot"),
  },
  // Link cards (iMessage, Slack) show the big image only for summary_large_image; og:image needs an absolute URL.
  twitter: { card: "summary_large_image" },
  metadataBase: new URL(SITE_URL),
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${fraunces.variable} ${source.variable}`}>
      <body className="min-h-screen flex flex-col overflow-x-hidden">
        <header className="relative z-30 border-b border-line/70 bg-card/60 backdrop-blur">
          <div className="mx-auto max-w-5xl px-4 py-1 flex items-center justify-between gap-x-4">
            {/* The mascot pops in and says hello once per visit (the layout stays mounted across pages), then idles. */}
            <Link href="/" aria-label={APP_NAME} className="text-ink !no-underline py-1.5 whitespace-nowrap">
              <MascotLogo size={42} className="hdr-logo" />
            </Link>
            <div className="flex items-center gap-4 sm:gap-6"><NavLinks /><TextUsPass /></div>
          </div>
        </header>
        {/* One look for the whole site: graphite + lime (graphite.css switches the tokens on <body> when it holds .owner-theme). */}
        <main className="flex-1"><div className="owner-theme">{children}</div></main>
        <footer className="border-t border-line/70 mt-16">
          <div className="mx-auto max-w-5xl px-4 py-8 text-soft text-base">
            {APP_NAME} is a prototype built for the AI for Small Business hackathon. Scores marked simulated come from
            practice runs, not real customers.
          </div>
        </footer>
      </body>
    </html>
  );
}
