import Link from "next/link";
import HeroPhone from "@/components/HeroPhone";
import Intake from "@/components/Intake";
import Marquee from "@/components/Marquee";
import TextMe from "@/components/TextMe";
import ShopTile from "@/components/ShopTile";
import { DEMO_BUSINESSES } from "@/data/demo";
import { IMESSAGE_DISPLAY, smsHref } from "@/lib/brand";

export default function Home() {
  return (
    <>
      {/* The first screen (sheet panel A): the line that says the whole flow, one lime action, and the phone showing the first texts. */}
      <section className="ob-hero">
        <div className="ob-street" aria-hidden><img src="/hero/street.jpg" alt="" /></div>
        <div className="mx-auto max-w-5xl px-4 pt-12 pb-10 sm:pt-20 lg:grid lg:grid-cols-[minmax(0,560px)_1fr] lg:items-start lg:gap-8 lg:pt-14 lg:pb-6">
          <div className="mx-auto max-w-[620px] lg:mx-0">
            <div className="ob-hello"><img src="/brand/mark.jpg" alt="" /><span>Hi, I&apos;m MainStreet.</span></div>
            <h1 className="mt-6 text-[2.6rem] sm:text-6xl leading-[1.04] text-balance">
              See which AI tools can save your business time.
            </h1>
            <p className="mt-5 text-xl text-soft">
              We read your website, pick the jobs AI can take off your plate, and compare tools we have checked. Nothing gets set up until you say yes.
            </p>
            <Intake />
            {/* The other door: the same assistant over iMessage. */}
            <p className="mt-5 text-lg text-soft">Rather text? <a href={smsHref()} className="font-semibold">Text us at {IMESSAGE_DISPLAY}</a> on iMessage.</p>
            {/* aa's "Text me" form, folded to a link so the hero keeps one lime action until the owner asks for it. */}
            <TextMe start="button" />
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
