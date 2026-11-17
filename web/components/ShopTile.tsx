import Link from "next/link";

/** An example business as a photo of that kind of shop, with its name over the photo. */
export default function ShopTile({ slug, name, place, kind, stats, big, aspect }: {
  slug: string; name: string; place: string; kind: string; stats?: string; big?: boolean; aspect?: string;
}) {
  return (
    <Link href={`/b/demo-${slug}`}
      className="group relative block overflow-hidden rounded-[22px] bg-ink text-white !no-underline shadow-[0_1px_2px_rgba(0,0,0,.06),0_14px_36px_rgba(17,18,20,.14)] transition-transform duration-200 ease-out active:scale-[0.98]">
      <img src={`/shops/${slug}.jpg`} alt="" loading="lazy" decoding="async"
        className={`w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03] ${aspect ?? (big ? "aspect-[16/10]" : "aspect-[4/5] sm:aspect-[3/4]")}`} />
      <div aria-hidden className="absolute inset-0 bg-[linear-gradient(to_top,rgb(10_11_13/.88),rgb(10_11_13/.35)_45%,transparent_70%)]" />
      <div className={`absolute inset-x-0 bottom-0 bg-[linear-gradient(to_top,rgb(10_11_13/.82),rgb(10_11_13/.66)_calc(100%_-_3.5rem),transparent)] pt-14 ${big ? "px-5 pb-5 sm:px-6 sm:pb-6" : "px-3.5 pb-3.5 sm:px-4 sm:pb-4"}`}>
        <p className={`font-semibold uppercase tracking-[.08em] text-white/85 ${big ? "text-sm" : "text-[.7rem]"}`}>{kind}</p>
        <p className={`mt-0.5 font-semibold leading-tight ${big ? "text-2xl sm:text-[1.7rem]" : "text-base sm:text-lg"}`}>{name}</p>
        <p className={`text-white/75 ${big ? "text-base" : "text-sm"}`}>{place}</p>
        {stats && <p className="mt-2 inline-block rounded-full bg-white/15 px-3 py-1 text-sm font-semibold backdrop-blur">{stats}</p>}
      </div>
    </Link>
  );
}
