import Link from "next/link";
import Intake from "@/components/Intake";
import ShopTile from "@/components/ShopTile";
import { DEMO_BUSINESSES } from "@/data/demo";
import { IMESSAGE_DISPLAY, smsHref } from "@/lib/brand";

const HERO = ["coffee", "salon", "diner"].map((slug) => DEMO_BUSINESSES.find((b) => b.slug === slug)!).filter(Boolean);

export default function Home() {
  return (
    <>
      <section className="mx-auto max-w-5xl px-4 pt-14 pb-12 sm:pt-24 lg:grid lg:grid-cols-[minmax(0,560px)_1fr] lg:items-start lg:gap-14">
        <div className="mx-auto max-w-[620px] lg:mx-0">
        <h1 className="text-[2.6rem] sm:text-6xl font-semibold leading-[1.05]">
          See which AI tools can save your business time.
        </h1>
        <p className="mt-4 text-xl text-soft">
          We read your website, pick the jobs AI can take off your plate, and compare tools we have checked. Nothing gets set up until you say yes.
        </p>
        <Intake />
        {/* The other door: the same assistant over iMessage. */}
        <p className="mt-5 text-lg text-soft">Rather text? <a href={smsHref()} className="font-semibold">Text us at {IMESSAGE_DISPLAY}</a> on iMessage.</p>
        </div>
        {/* Desktop: the example shops sit beside the form. Phones get the strip below. */}
        <ul aria-label="Example businesses" className="hidden lg:grid grid-cols-2 gap-4 pt-2">
          {HERO.map((b, i) => (
            <li key={b.slug} className={i === 0 ? "row-span-2 self-center" : ""}>
              <ShopTile slug={b.slug} name={b.name} place={b.place} kind={b.kind} aspect={i === 0 ? "aspect-[3/4]" : "aspect-[4/3]"} />
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="examples" className="mx-auto max-w-5xl px-4 pb-6 lg:hidden">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="examples" className="text-2xl font-semibold">Made for Main Street</h2>
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
