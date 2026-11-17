"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { linkCode } from "@/lib/api";
import { IMESSAGE_DISPLAY, IMESSAGE_NUMBER, smsHref } from "@/lib/brand";
import TextMe from "./TextMe";

/**
 * The second door: carry this shop on in iMessage. Texting the shop code to the line ties that phone to this shop
 * (same assistant, same plan, same answers), and from then on what happens here is texted to the phone too.
 * On a computer a QR code does the typing: the phone's camera opens Messages with the code already written.
 */
export default function TextUs({ ownerId, linked }: { ownerId: string; linked: boolean }) {
  const [code, setCode] = useState<string | null>(null);
  const [qr, setQr] = useState("");

  useEffect(() => {
    if (linked) return;
    let gone = false;
    linkCode(ownerId).then((r) => { if (!gone) setCode(r.code); }, () => {});
    return () => { gone = true; };
  }, [ownerId, linked]);

  const body = code ? `Hi! My shop code is ${code}` : "";
  useEffect(() => {
    if (!body) return;
    let gone = false;
    // SMSTO is the QR form phone cameras read as "text this number this message".
    QRCode.toString(`SMSTO:${IMESSAGE_NUMBER}:${body}`, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#141518", light: "#ffffff" } })
      .then((svg) => { if (!gone) setQr(svg); }, () => {});
    return () => { gone = true; };
  }, [body]);

  if (linked) {
    return (
      <section aria-label="Texting" className="mt-4 flex items-start gap-3 rounded-2xl bg-grey-tint px-4 py-3">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0 text-accent-dark"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        <p className="text-base leading-snug">
          <span className="font-semibold">Your phone is on this shop too.</span>{" "}
          <span className="text-muted">Text <a href={smsHref()} className="font-semibold text-ink">{IMESSAGE_DISPLAY}</a> anytime. Same shop, same answers.</span>
        </p>
      </section>
    );
  }
  if (!code) return null;
  return (
    <section aria-label="Rather text?" className="mt-4 flex items-center gap-4 rounded-2xl border border-line bg-raised px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <p className="eyebrow">Rather text?</p>
        <p className="mt-1 text-lg leading-snug">Carry on in iMessage. Same shop, same plan, same answers.</p>
        <p className="mt-3 text-base text-muted leading-snug">
          Text the code{" "}
          <strong data-testid="shop-code" className="font-display text-2xl font-semibold tracking-[0.06em] text-ink tabular-nums">{code}</strong>
          <br />to {IMESSAGE_DISPLAY}<span className="hidden sm:inline">, or scan this with your phone</span>
        </p>
        <a href={smsHref(body)} className="btn btn-primary mt-3 !min-h-11 !px-5 hover:no-underline">Open Messages</a>
        <TextMe ownerId={ownerId} start="button" />
      </div>
      {qr && (
        <div role="img" aria-label={`QR code: text ${code} to ${IMESSAGE_DISPLAY}`} data-testid="shop-qr"
          className="hidden sm:block size-[132px] shrink-0 overflow-hidden rounded-xl bg-white p-1.5 [&>svg]:block [&>svg]:size-full"
          dangerouslySetInnerHTML={{ __html: qr }} />
      )}
    </section>
  );
}
