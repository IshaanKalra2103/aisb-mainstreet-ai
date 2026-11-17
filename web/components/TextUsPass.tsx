"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import QRCode from "qrcode";
import Link from "next/link";
import { IMESSAGE_DISPLAY } from "@/lib/brand";
import MascotLogo from "./MascotLogo";
import { ObIcon } from "./obIcons";

/**
 * The header's Text us. It goes to /text, the iMessage onboarding (our line answers only numbers on its list, so the
 * number is added there first). On a computer, hovering or focusing it raises a pass with a QR code that opens /text on
 * the phone (Quest's hover-to-QR, Ladder's pass, Abode's big number).
 * Hidden on owner pages: a plain text there would start a new shop, and that page's own TextUs box carries the shop code.
 */
export default function TextUsPass() {
  const path = usePathname();
  const [qr, setQr] = useState("");

  useEffect(() => {
    let gone = false;
    QRCode.toString(`${window.location.origin}/text`, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#121317", light: "#f1f1ee" } })
      .then((svg) => { if (!gone) setQr(svg); }, () => {});
    return () => { gone = true; };
  }, []);

  if (path.startsWith("/b/") || path === "/text") return null;
  return (
    // Phones get the "Rather text?" link in the page instead: the header has no room for a third item at 390 px.
    <div className="ob-textus hidden sm:block">
      <Link href="/text" className="ob-ghost" aria-describedby="textus-pass">
        <ObIcon name="message" size={18} />Text us
      </Link>
      <div id="textus-pass" role="tooltip" className="ob-pass">
        <div className="top"><MascotLogo size={22} play="idle" wordmark={false} />Text MainStreet<span className="ob-live" aria-hidden /></div>
        {qr && <div className="qr" aria-hidden dangerouslySetInnerHTML={{ __html: qr }} />}
        <div className="num">{IMESSAGE_DISPLAY}</div>
        <div className="hint">Point your phone&apos;s camera here</div>
      </div>
    </div>
  );
}
