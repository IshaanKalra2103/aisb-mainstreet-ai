"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, createOwner, health, startTurn } from "@/lib/api";
import OfflineBanner from "./OfflineBanner";
import { ObIcon, type IconName } from "./obIcons";

/** No website: what the shop sells, as tiles, so the owner taps instead of types. Each becomes the sentence the agent reads. */
export const KINDS: { id: string; label: string; icon: IconName; says: string }[] = [
  { id: "coffee", label: "Coffee", icon: "coffee", says: "a coffee shop" },
  { id: "salon", label: "Salon", icon: "scissors", says: "a hair salon" },
  { id: "diner", label: "Diner", icon: "kitchen", says: "a diner" },
  { id: "repairs", label: "Repairs", icon: "tools", says: "a home repair business" },
  { id: "landscaping", label: "Landscaping", icon: "plant", says: "a landscaping company" },
  { id: "other", label: "Other", icon: "dots", says: "" },
];

/** What the wait screen calls the site: "beanandbrick.com" for a link, nothing for a sentence. */
function siteName(text: string): string {
  const t = text.trim();
  if (/\s/.test(t) || !/\.[a-z]{2,}/i.test(t)) return "";
  return t.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "");
}

export default function Intake() {
  const router = useRouter();
  const [online, setOnline] = useState<boolean | null>(null);
  const [text, setText] = useState("");
  const [kind, setKind] = useState<string | null>(null);
  const [extra, setExtra] = useState("");
  const [busy, setBusy] = useState<"site" | "kind" | null>(null);
  // Which way the owner came in (their site or what they sell), so the error shows under that form.
  const [error, setError] = useState<{ from: "site" | "kind"; text: string } | null>(null);
  // Reuse an owner whose first turn was refused (busy), so retries do not use up the per-client owner cap.
  const ownerRef = useRef<string | null>(null);

  useEffect(() => {
    let gone = false;
    health().then((ok) => { if (!gone) setOnline(ok); });
    return () => { gone = true; };
  }, []);

  const picked = KINDS.find((k) => k.id === kind);
  // "a coffee shop in Frederick, MD", or for Other the owner's own sentence.
  const sentence = picked
    ? (picked.says ? `${picked.says}${extra.trim() ? ` in ${extra.trim()}` : ""}` : extra.trim())
    : "";

  async function go(described: string, from: "site" | "kind") {
    if (online === false) { router.push("/demo"); return; }
    if (!described) return;
    setBusy(from); setError(null);
    try {
      const owner = ownerRef.current ?? (ownerRef.current = await createOwner(described));
      const turn = await startTurn(owner, `Here is my business: ${described}. What should I try first?`);
      const site = siteName(described);
      router.push(`/b/${owner}?turn=${turn}${site ? `&site=${encodeURIComponent(site)}` : ""}`);
    } catch (err) {
      if (err instanceof ApiError && err.status < 500) {
        setError({ from, text: err.message }); // a limit (429) or a bad request: the agent is up, so stay here
      } else {
        setError({ from, text: "We could not reach our agent just now. You can still look at the example businesses." });
        setOnline(false);
      }
      setBusy(null);
    }
  }

  const alert = (from: "site" | "kind") =>
    error?.from === from ? <p role="alert" className="text-brick font-semibold">{error.text}</p> : null;

  // Both ways in, one under the other: the site first, then what you sell for a shop with no website.
  return (
    <div className="mt-8 grid gap-10">
      {online === false && <OfflineBanner />}
      <form onSubmit={(e) => { e.preventDefault(); void go(text.trim(), "site"); }} className="grid gap-3">
        <label htmlFor="intake" className="ob-start-label">Paste your website</label>
        <div className="ob-field">
          <div className="ob-input">
            <ObIcon name="world" size={22} />
            <input id="intake" type="text" value={text} onChange={(e) => setText(e.target.value)}
              placeholder="yourshop.com" required={online === true} autoComplete="url" />
          </div>
          <button className="btn btn-primary" disabled={!!busy}>{busy === "site" ? "Reading..." : "Read my site"}</button>
        </div>
        {alert("site")}
      </form>

      <form onSubmit={(e) => { e.preventDefault(); void go(sentence, "kind"); }} className="ob-pick" aria-label="Tell us what you sell">
        <h2 className="ob-start-label">No website? Tell us what you sell.</h2>
        <div role="radiogroup" aria-label="What you sell" className="ob-tiles">
          {KINDS.map((k) => (
            <button key={k.id} type="button" role="radio" aria-checked={kind === k.id} className="ob-tile" onClick={() => setKind(k.id)}>
              <ObIcon name={k.icon} size={26} />{k.label}
            </button>
          ))}
        </div>
        {kind && (
          <>
            <label className="grid gap-2 text-base text-soft">
              {kind === "other" ? "What do you sell, and where?" : "Where is it? (optional)"}
              <span className="ob-field !block"><span className="ob-input">
                <input value={extra} onChange={(e) => setExtra(e.target.value)} required={kind === "other"}
                  placeholder={kind === "other" ? "a food truck in Frederick" : "Frederick, MD"} />
              </span></span>
            </label>
            {alert("kind")}
            <button className="btn btn-primary w-full !min-h-14 !text-lg" disabled={!!busy || !sentence}>
              {busy === "kind" ? "One moment..." : "Next"}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
