"use client";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { addPhone, ApiError } from "@/lib/api";
import { IMESSAGE_DISPLAY, IMESSAGE_NUMBER, smsHref } from "@/lib/brand";
import { KINDS } from "./Intake";
import { ObIcon } from "./obIcons";

/**
 * The iMessage door. Our line (Photon's free plan) only answers numbers on its allowed list, so before anyone texts
 * it we ask for a first name, a mobile number and the shop (its website, or what it sells), put the number on the
 * list (POST /api/phone with welcome: false, so the line does not text first), and then open Messages with the
 * owner's first text already written. On a computer a QR code does the same from the phone's camera.
 */
const STEPS = ["Checking your number", "Adding it to our iMessage line", "Writing your first text"];

export default function TextOnboard() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [site, setSite] = useState("");
  const [kind, setKind] = useState<string | null>(null);
  const [extra, setExtra] = useState("");
  const [stage, setStage] = useState<"form" | "adding" | "ready">("form");
  const [step, setStep] = useState(0);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState("");
  const [qr, setQr] = useState("");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const picked = KINDS.find((k) => k.id === kind);
  const shop = site.trim()
    ? `My shop's website is ${site.trim().replace(/^https?:\/\//i, "").replace(/\/$/, "")}`
    : picked
      ? `I run ${picked.says ? `${picked.says}${extra.trim() ? ` in ${extra.trim()}` : ""}` : extra.trim()}`
      : "";
  const first = name.trim().split(/\s+/)[0] ?? "";
  // No full stop after a website, so Messages links it cleanly.
  const draft = `Hi! I'm ${first}. ${shop}${site.trim() || /[.!?]$/.test(shop) ? "" : "."}`;
  const ready = !!first && !!phone.trim() && (!!site.trim() || (!!picked && (picked.says !== "" || !!extra.trim())));

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  useEffect(() => {
    if (stage !== "ready") return;
    let gone = false;
    // SMSTO is the QR form phone cameras read as "text this number this message".
    QRCode.toString(`SMSTO:${IMESSAGE_NUMBER}:${draft}`, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#141518", light: "#ffffff" } })
      .then((svg) => { if (!gone) setQr(svg); }, () => {});
    return () => { gone = true; };
  }, [stage, draft]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) { setError(site.trim() || picked ? "Add your first name and mobile number." : "Add your website, or pick what you sell."); return; }
    setError(""); setStage("adding"); setStep(0); setSlow(false);
    timers.current.forEach(clearTimeout);
    // The steps move on their own while Photon adds the number (about 2 to 4 s; longer if our server was asleep).
    timers.current = [setTimeout(() => setStep(1), 900), setTimeout(() => setSlow(true), 9000)];
    const started = Date.now();
    try {
      await addPhone({ first_name: name.trim(), phone: phone.trim(), welcome: false });
      setStep(2);
      await new Promise((r) => setTimeout(r, Math.max(700, 2200 - (Date.now() - started))));
      setStage("ready");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `That did not go through. Please try again in a minute, or text ${IMESSAGE_DISPLAY}.`);
      setStage("form");
    } finally {
      timers.current.forEach(clearTimeout);
    }
  }

  if (stage === "adding") {
    return (
      <div role="status" aria-live="polite" data-testid="onboard-adding" className="mt-8 rounded-3xl border border-line bg-raised px-6 py-8">
        <div className="flex items-center gap-4">
          <span aria-hidden className="size-7 shrink-0 rounded-full border-[3px] border-line border-t-accent animate-spin motion-reduce:animate-none" />
          <p className="text-xl font-semibold">Adding your number…</p>
        </div>
        <ol className="mt-6 grid gap-3">
          {STEPS.map((s, i) => (
            <li key={s} className={`flex items-center gap-3 text-lg ${i <= step ? "text-ink" : "text-muted"}`}>
              <span className={`grid size-6 place-items-center rounded-full ${i < step ? "bg-accent text-[#141518]" : "border border-line"}`}>
                {i < step && <ObIcon name="check" size={14} stroke={2.6} />}
              </span>
              {s}
            </li>
          ))}
        </ol>
        {slow && <p className="mt-5 text-base text-soft">Waking our server. A few more seconds.</p>}
      </div>
    );
  }

  if (stage === "ready") {
    return (
      <div data-testid="onboard-ready" className="mt-8 rounded-3xl border border-line bg-raised px-6 py-7">
        <p className="eyebrow">You&apos;re on the line</p>
        <h2 className="mt-1 text-3xl leading-tight">Now send your first text.</h2>
        <p className="mt-2 text-lg text-soft">Messages opens with this already typed. Tap send and we&apos;ll take it from there.</p>
        <div className="mt-5 flex flex-wrap items-center gap-6">
          <div className="min-w-0 flex-1">
            <p data-testid="onboard-draft" className="ml-auto w-fit max-w-full rounded-[20px] rounded-br-md bg-[#0a84ff] px-4 py-2.5 text-lg leading-snug text-white">{draft}</p>
            <p className="mt-1 text-right text-sm text-muted">to {IMESSAGE_DISPLAY}</p>
            <a href={smsHref(draft)} data-testid="onboard-open" className="btn btn-primary mt-5 w-full !min-h-14 !text-lg hover:no-underline">
              <ObIcon name="message" size={22} />Open Messages
            </a>
          </div>
          {qr && (
            <div className="hidden sm:grid justify-items-center gap-2">
              <div role="img" aria-label={`QR code: text MainStreet AI at ${IMESSAGE_DISPLAY}`} data-testid="onboard-qr"
                className="size-[150px] overflow-hidden rounded-xl bg-white p-1.5 [&>svg]:block [&>svg]:size-full"
                dangerouslySetInnerHTML={{ __html: qr }} />
              <p className="text-sm text-muted">On a computer? Scan it.</p>
            </div>
          )}
        </div>
        <button type="button" onClick={() => setStage("form")} className="mt-5 text-base font-semibold text-ink underline underline-offset-4">
          Change something
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} aria-label="Text with MainStreet AI" data-testid="onboard" className="mt-8 grid gap-7" noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-2">
          <span className="ob-start-label">First name</span>
          <span className="ob-field !block"><span className="ob-input">
            <input id="ob-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Priya" autoComplete="given-name" maxLength={40} />
          </span></span>
        </label>
        <label className="grid gap-2">
          <span className="ob-start-label">Mobile number</span>
          <span className="ob-field !block"><span className="ob-input">
            <input id="ob-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(240) 555-1234" autoComplete="tel" maxLength={30} />
          </span></span>
        </label>
      </div>

      <label className="grid gap-2">
        <span className="ob-start-label">Your shop&apos;s website</span>
        <span className="ob-field !block"><span className="ob-input">
          <ObIcon name="world" size={22} />
          <input id="ob-site" value={site} onChange={(e) => { setSite(e.target.value); if (e.target.value) setKind(null); }} placeholder="yourshop.com" autoComplete="url" />
        </span></span>
      </label>

      <div className="ob-pick !mt-0">
        <h2 className="ob-start-label">No website? Pick what you sell.</h2>
        <div role="radiogroup" aria-label="What you sell" className="ob-tiles">
          {KINDS.map((k) => (
            <button key={k.id} type="button" role="radio" aria-checked={kind === k.id} className="ob-tile"
              onClick={() => { setKind(k.id); setSite(""); }}>
              <ObIcon name={k.icon} size={26} />{k.label}
            </button>
          ))}
        </div>
        {kind && (
          <label className="mt-3 grid gap-2 text-base text-soft">
            {kind === "other" ? "What do you sell, and where?" : "Where is it? (optional)"}
            <span className="ob-field !block"><span className="ob-input">
              <input value={extra} onChange={(e) => setExtra(e.target.value)}
                placeholder={kind === "other" ? "a food truck in Frederick" : "Frederick, MD"} />
            </span></span>
          </label>
        )}
      </div>

      {error && <p role="alert" className="text-brick font-semibold">{error}</p>}
      <button className="btn btn-primary w-full !min-h-14 !text-lg">Add my number</button>
      <p className="-mt-3 text-sm leading-snug text-muted">
        US mobile numbers. Photon, our texting service, keeps your number so the line can text with you. We keep only a scrambled copy.
      </p>
    </form>
  );
}
