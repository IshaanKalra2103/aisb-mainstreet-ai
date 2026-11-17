"use client";

import "@/app/graphite.css";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ApiError, startTurn } from "@/lib/api";
import { normalizeLink, shopTurnText, type ShopLocation } from "@/lib/shop";

type LocState = "idle" | "asking" | "added" | "off";

/** "Where's your shop?": the location (browser prompt) and one link, sent as one turn; then back to the owner's page. */
export default function ShopShare({ ownerId }: { ownerId: string }) {
  const router = useRouter();
  const [raw, setRaw] = useState("");
  const [loc, setLoc] = useState<ShopLocation | null>(null);
  const [locState, setLocState] = useState<LocState>("idle");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The web-address warning waits until the owner leaves the field or taps Share: mid-typing text is not a link yet.
  const [linkChecked, setLinkChecked] = useState(false);
  const busy = useRef(false); // a double tap lands before React re-renders the disabled button
  const linkField = useRef<HTMLInputElement>(null);
  const page = `/b/${ownerId}`;
  const link = normalizeLink(raw);
  // Typed text that is not a link (an @handle, a shop name) would otherwise go out as "Link: none" without a word.
  const badLink = raw.trim() !== "" && link === null;
  const showBadLink = badLink && linkChecked;
  const canShare = (raw.trim() !== "" || loc !== null) && !posting;

  function askLocation() {
    if (!("geolocation" in navigator)) {
      setLocState("off");
      return;
    }
    setLocState("asking");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLoc({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy });
        setLocState("added");
      },
      () => {
        setLoc(null);
        setLocState("off");
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  }

  async function share(e: React.FormEvent) {
    e.preventDefault();
    if (busy.current || !canShare) return;
    if (badLink) {
      setLinkChecked(true);
      linkField.current?.focus();
      return;
    }
    busy.current = true;
    setPosting(true);
    setError(null);
    try {
      // Example businesses have no agent behind them: go straight to their page.
      if (!ownerId.startsWith("demo-")) await startTurn(ownerId, shopTurnText(link, loc));
      router.push(page);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We could not send that. Please try again in a minute.");
      busy.current = false;
      setPosting(false);
    }
  }

  return (
    <section className="theme-graphite">
      <form className="shop-card" onSubmit={share} noValidate>
        <div className="shop-map" aria-hidden>
          <img src="/places/map.jpg" alt="" />
          <span className={`shop-pin${locState === "added" ? " is-set" : ""}`}><PinIcon /></span>
        </div>
        <h1>Where&apos;s your shop?</h1>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <button type="button" className="shop-ghost" onClick={askLocation} disabled={locState === "asking"}>
            <PinIcon />
            Use my location
          </button>
          {locState === "added" && loc && (
            <p className="shop-note" role="status">Location added.</p>
          )}
          {locState === "off" && <p className="shop-note" role="status">Location is off. Your link is enough.</p>}
        </div>

        <label>
          Your website, Google Maps or Instagram link
          <input
            ref={linkField}
            type="text"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="url"
            placeholder="yourshop.com"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            onBlur={() => setLinkChecked(true)}
            aria-invalid={showBadLink || undefined}
            aria-describedby={showBadLink ? "shop-link-note" : undefined}
          />
        </label>
        {showBadLink && (
          <p id="shop-link-note" className="shop-note" role="status">
            That doesn&apos;t look like a web address. Paste the full link, or clear it.
          </p>
        )}

        {error && <p className="shop-error" role="alert">{error}</p>}

        <button type="submit" className="shop-share" disabled={!canShare}>
          Share
        </button>
        <Link href={page} className="shop-skip">
          Skip for now
        </Link>
      </form>
    </section>
  );
}

/** Tabler "map-pin" outline, 24px grid, stroke 1.75 next to 400-weight text. */
function PinIcon() {
  return (
    <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
      strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" />
      <path d="M17.657 16.657l-4.243 4.243a2 2 0 0 1 -2.827 0l-4.244 -4.243a8 8 0 1 1 11.314 0z" />
    </svg>
  );
}
