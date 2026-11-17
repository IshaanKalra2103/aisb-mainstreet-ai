"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import QRCode from "qrcode";
import { IMESSAGE_DISPLAY, IMESSAGE_NUMBER, smsHref } from "@/lib/brand";
import { ObIcon } from "./obIcons";

const HELLO = "Hi";

/**
 * The header's Text us. On a phone it opens Messages with "Hi" typed in. On a computer, hovering or focusing it raises a
 * pass with a QR code that does the same from the phone's camera (Quest's hover-to-QR, Ladder's pass, Abode's big number).
 * Hidden on owner pages: a plain text there would start a new shop, and that page's own TextUs box carries the shop code.
 */
export default function TextUsPass() {
  const path = usePathname();
  const [qr, setQr] = useState("");

  useEffect(() => {
    let gone = false;
    // SMSTO is the QR form phone cameras read as "text this number this message".
    QRCode.toString(`SMSTO:${IMESSAGE_NUMBER}:${HELLO}`, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#121317", light: "#f1f1ee" } })
      .then((svg) => { if (!gone) setQr(svg); }, () => {});
    return () => { gone = true; };
  }, []);

  if (path.startsWith("/b/")) return null;
  return (
    // Phones get the "Rather text?" link in the page instead: the header has no room for a third item at 390 px.
    <div className="ob-textus hidden sm:block">
      <a href={smsHref(HELLO)} className="ob-ghost" aria-describedby="textus-pass">
        <ObIcon name="message" size={18} />Text us
      </a>
      <div id="textus-pass" role="tooltip" className="ob-pass">
        <div className="top"><img src="/brand/mark.jpg" alt="" />Text MainStreet<span className="ob-live" aria-hidden /></div>
        {qr && <div className="qr" aria-hidden dangerouslySetInnerHTML={{ __html: qr }} />}
        <div className="num">{IMESSAGE_DISPLAY}</div>
        <div className="hint">Point your phone&apos;s camera here</div>
      </div>
    </div>
  );
}
