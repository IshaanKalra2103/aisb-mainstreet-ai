import Link from "next/link";
import HeroPhone from "@/components/HeroPhone";
import Marquee from "@/components/Marquee";
import { ObIcon } from "@/components/obIcons";
import ShopTile from "@/components/ShopTile";
import { DEMO_BUSINESSES } from "@/data/demo";
import { IMESSAGE_DISPLAY, smsHref } from "@/lib/brand";

export default function Home() {
  return (
    <>
      {/* The first screen (sheet panel A): the line that says the whole flow, one lime action (to /start) beside the iMessage door, and the phone showing the first texts. */}
      <section className="ob-hero">
        <div className="ob-street" aria-hidden><img src="/hero/street.jpg" alt="" /></div>
        <div className="mx-auto max-w-5xl px-4 pt-12 pb-10 sm:pt-20 lg:grid lg:grid-cols-[minmax(0,560px)_1fr] lg:items-center lg:gap-8 lg:pt-14 lg:pb-6">
          <div className="mx-auto max-w-[620px] lg:mx-0">
            <h1 className="text-[2.6rem] sm:text-6xl leading-[1.04] text-balance">
              See which AI tools can save your business time.
            </h1>
            <p className="mt-5 text-xl text-soft">
              We read your website, pick the jobs AI can take off your plate, and compare tools we have checked. Nothing gets set up until you say yes.
            </p>
            {/* Two doors: try it on the web (the site box and the what-you-sell tiles are on /start), or text the same agent. */}
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/start" className="btn btn-primary ob-cta">Try it with your shop</Link>
              <a href={smsHref()} title={`iMessage ${IMESSAGE_DISPLAY}`} className="btn btn-secondary ob-cta">
                <ObIcon name="message" size={22} />Text our iMessage agent
              </a>
            </div>
          </div>
          <div className="hidden lg:block"><HeroPhone /></div>
        </div>
        <Marquee />
      </section>

      <section aria-labelledby="examples" className="mx-auto max-w-5xl px-4 pt-12 pb-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="examples" className="text-2xl">Made for Main Street</h2>
          <Link href="/demo" className="font-semibold">See five example businesses</Link>
        </div>
        <ul className="mt-4 -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-5 sm:overflow-visible sm:px-0">
          {DEMO_BUSINESSES.map((b) => (
            <li key={b.slug} className="w-[44%] shrink-0 snap-start sm:w-auto">
              <ShopTile slug={b.slug} name={b.name} place={b.place} kind={b.kind} />
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
