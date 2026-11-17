"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, createOwner, health, startTurn } from "@/lib/api";
import OfflineBanner from "./OfflineBanner";
import { ObIcon, type IconName } from "./obIcons";

/** No website: what the shop sells, as tiles, so the owner taps instead of types. Each becomes the sentence the agent reads. */
const KINDS: { id: string; label: string; icon: IconName; says: string }[] = [
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
  const [picking, setPicking] = useState(false);
  const [kind, setKind] = useState<string | null>(null);
  const [extra, setExtra] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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

  async function go(described: string) {
    if (online === false) { router.push("/demo"); return; }
    if (!described) return;
    setBusy(true); setError("");
    try {
      const owner = ownerRef.current ?? (ownerRef.current = await createOwner(described));
      const turn = await startTurn(owner, `Here is my business: ${described}. What should I try first?`);
      const site = siteName(described);
      router.push(`/b/${owner}?turn=${turn}${site ? `&site=${encodeURIComponent(site)}` : ""}`);
    } catch (err) {
      if (err instanceof ApiError && err.status < 500) {
        setError(err.message); // a limit (429) or a bad request: the agent is up, so stay here
      } else {
        setError("We could not reach our agent just now. You can still look at the example businesses.");
        setOnline(false);
      }
      setBusy(false);
    }
  }

  if (picking) {
    return (
      <form onSubmit={(e) => { e.preventDefault(); void go(sentence); }} className="ob-pick mt-8" aria-label="Tell us what you sell">
        {online === false && <OfflineBanner />}
        <div className="flex items-center gap-5">
          <img src="/brand/mascot.webp" alt="" aria-hidden className="ob-mascot shrink-0" />
          <h2 className="text-[1.9rem] leading-[1.08]">No website? Tell us what you sell.</h2>
        </div>
        <div role="radiogroup" aria-label="What you sell" className="ob-tiles">
          {KINDS.map((k) => (
            <button key={k.id} type="button" role="radio" aria-checked={kind === k.id} className="ob-tile" onClick={() => setKind(k.id)}>
              <ObIcon name={k.icon} size={26} />{k.label}
            </button>
          ))}
        </div>
        {kind && (
          <label className="grid gap-2 text-base text-soft">
            {kind === "other" ? "What do you sell, and where?" : "Where is it? (optional)"}
            <span className="ob-field !block"><span className="ob-input">
              <input value={extra} onChange={(e) => setExtra(e.target.value)} required={kind === "other"}
                placeholder={kind === "other" ? "a food truck in Frederick" : "Frederick, MD"} />
            </span></span>
          </label>
        )}
        {error && <p role="alert" className="text-brick font-semibold">{error}</p>}
        <button className="btn btn-primary w-full !min-h-14 !text-lg" disabled={busy || !sentence}>
          {busy ? "One moment..." : "Next"}
        </button>
        <button type="button" className="justify-self-start text-base text-soft underline underline-offset-4" onClick={() => setPicking(false)}>
          I have a website
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void go(text.trim()); }} className="mt-8 grid gap-4">
      {online === false && <OfflineBanner />}
      <label htmlFor="intake" className="sr-only">Paste your website</label>
      <div className="ob-field">
        <div className="ob-input">
          <ObIcon name="world" size={22} />
          <input id="intake" type="text" value={text} onChange={(e) => setText(e.target.value)}
            placeholder="yourshop.com" required={online === true} autoComplete="url" aria-describedby="intake-hint" />
        </div>
        <button className="btn btn-primary" disabled={busy}>{busy ? "Reading..." : "Read my site"}</button>
      </div>
      {error && <p role="alert" className="text-brick font-semibold">{error}</p>}
      <div id="intake-hint" className="ob-alt">
        No website?
        <button type="button" className="ob-ghost" onClick={() => setPicking(true)}>Tell us what you sell</button>
      </div>
    </form>
  );
}
