import type { Metadata } from "next";
import Intake from "@/components/Intake";
import TextMe from "@/components/TextMe";
import { IMESSAGE_DISPLAY, SITE_DRAFT, smsHref } from "@/lib/brand";

export const metadata: Metadata = { title: "Try it with your shop" };

/** The home page's "Try it with your shop": the site box, the what-you-sell tiles for a shop with no website, and the iMessage door. */
export default function StartPage() {
  return (
    <section className="mx-auto max-w-[620px] px-4 pt-10 pb-16 sm:pt-16">
      <div className="flex items-center gap-4 sm:gap-5">
        <img src="/brand/mascot.webp" alt="" aria-hidden className="ob-start-mascot" />
        <h1 className="text-[2.2rem] sm:text-5xl leading-[1.05] text-balance">Let&apos;s look at your shop.</h1>
      </div>
      <p className="mt-4 text-xl text-soft">We read your website and pick the jobs AI can take off your plate. No website? Pick what you sell.</p>
      <Intake />
      <div className="mt-12 border-t border-line pt-6">
        <p className="text-lg text-soft">Rather text? <a href={smsHref(SITE_DRAFT)} className="font-semibold">Text us at {IMESSAGE_DISPLAY}</a> on iMessage.</p>
        {/* aa's "Text me" form, folded to a link until the owner asks for it. */}
        <TextMe start="button" />
      </div>
    </section>
  );
}
