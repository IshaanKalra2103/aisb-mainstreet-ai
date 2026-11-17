"use client";
import { useState } from "react";
import { addPhone, ApiError } from "@/lib/api";
import { IMESSAGE_DISPLAY } from "@/lib/brand";

/**
 * "Text me": the iMessage line texts this visitor first. The API puts the number on the line's allowed list
 * (Photon texts only those), ties it to `ownerId`'s shop when there is one, and the relay sends the first text.
 * Photon needs a name and an email with every number. Without `ownerId` (home page) the first text asks for the shop.
 * `start`: "button" shows only a link until tapped (inside the shop page's "Rather text?" box), "open" shows the form.
 */
export default function TextMe({ ownerId, start = "open" }: { ownerId?: string; start?: "button" | "open" }) {
  const [open, setOpen] = useState(start === "open");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  if (state === "sent") {
    return (
      <p role="status" data-testid="textme-sent" className="mt-3 flex items-start gap-2 text-base leading-snug">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0 text-accent-dark"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        <span><span className="font-semibold">Check your phone.</span>{" "}
          <span className="text-muted">We&apos;re texting you from {IMESSAGE_DISPLAY} now. Reply there anytime.</span></span>
      </p>
    );
  }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} data-testid="textme-open"
        className="mt-3 block text-base font-semibold text-ink underline underline-offset-4">
        Or have us text you first
      </button>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setError("");
    try {
      await addPhone({ first_name: name.trim(), email: email.trim(), phone: phone.trim(), ...(ownerId && { owner_id: ownerId }) });
      setState("sent");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That did not go through. Please try again in a minute.");
      setState("idle");
    }
  }

  return (
    <form onSubmit={submit} aria-label="Have us text you" data-testid="textme" className="mt-3 grid gap-2.5">
      {start === "open" && <p className="text-lg leading-snug">We&apos;ll text you from {IMESSAGE_DISPLAY}.</p>}
      <label className="sr-only" htmlFor="tm-name">First name</label>
      <input id="tm-name" className="field" placeholder="First name" autoComplete="given-name" required maxLength={40}
        value={name} onChange={(e) => setName(e.target.value)} />
      <label className="sr-only" htmlFor="tm-email">Email</label>
      <input id="tm-email" className="field" type="email" placeholder="Email" autoComplete="email" required maxLength={200}
        value={email} onChange={(e) => setEmail(e.target.value)} />
      <label className="sr-only" htmlFor="tm-phone">Mobile number</label>
      <input id="tm-phone" className="field" type="tel" inputMode="tel" placeholder="Mobile number" autoComplete="tel" required maxLength={30}
        value={phone} onChange={(e) => setPhone(e.target.value)} />
      {error && <p role="alert" className="text-base leading-snug text-brick font-semibold">{error}</p>}
      <button type="submit" disabled={state === "sending"} className="btn btn-primary !min-h-11 !px-5 justify-self-start disabled:opacity-60">
        {state === "sending" ? "Adding your number..." : "Text me"}
      </button>
      <p className="text-sm leading-snug text-muted">
        US mobile numbers. Photon, our texting service, keeps your number and email so the line can text you. We keep neither.
      </p>
    </form>
  );
}
