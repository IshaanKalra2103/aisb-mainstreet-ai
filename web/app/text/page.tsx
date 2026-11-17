import type { Metadata } from "next";
import TextOnboard from "@/components/TextOnboard";

export const metadata: Metadata = { title: "Text with MainStreet AI" };

/** The iMessage door: name, number and shop, the number goes on our line's list, then Messages opens with the first text written. */
export default function TextPage() {
  return (
    <section className="mx-auto max-w-[620px] px-4 pt-10 pb-16 sm:pt-16">
      <div className="flex items-center gap-4 sm:gap-5">
        <img src="/brand/mascot.webp" alt="" aria-hidden className="ob-start-mascot" />
        <h1 className="text-[2.2rem] sm:text-5xl leading-[1.05] text-balance">Text with MainStreet AI.</h1>
      </div>
      <p className="mt-4 text-xl text-soft">Tell us who you are and about your shop. We add your number to our iMessage line, then you send the first text.</p>
      <TextOnboard />
    </section>
  );
}
