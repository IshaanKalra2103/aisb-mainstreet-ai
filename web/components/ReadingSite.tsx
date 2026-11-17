import { useState } from "react";
import { ObIcon } from "./obIcons";
import MascotLogo from "./MascotLogo";

/**
 * The wait while the agent works (sheet panel F): a pulse around the shop's photo, or the mascot before we have one
 * (Cal AI listening), each step ticking in as the agent reaches it (Reddit), the current one still pulsing, and a bar
 * that fills with the steps. No percent: the agent does not know its own length, so a number would be made up.
 * A site with no usable photo (the route answers 404) gets the mascot too, not a broken image.
 */
export default function ReadingSite({ title, steps, photo }: { title: string; steps: string[]; photo: string | null }) {
  const [failed, setFailed] = useState<string | null>(null);
  const shop = photo !== failed ? photo : null;
  const shown = steps.slice(-5);
  const fill = Math.min(0.9, 0.08 + steps.length / 7);
  return (
    <div className="ob-read">
      <div className="ob-site" aria-hidden>
        <span className="ob-ring" /><span className="ob-ring" />
        {shop
          ? <img src={shop} alt="" onError={() => setFailed(shop)} />
          : <span className="ob-mascot-live"><MascotLogo size={96} wordmark={false} /></span>}
      </div>
      <h2 className="mt-7 text-[1.9rem] leading-[1.1] text-balance">{title}</h2>
      <div className="ob-meter" aria-hidden><i style={{ transform: `scaleX(${fill})` }} /></div>
      {shown.length > 0 && (
        <ul className="ob-steps">
          {shown.map((s, i) => {
            const now = i === shown.length - 1;
            return (
              <li key={s} className={now ? "now" : ""}>
                {now ? <span className="ob-tick wait" /> : <span className="ob-tick"><ObIcon name="check" size={16} stroke={2.6} /></span>}
                {s}
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-6 text-base text-muted">This can take a minute or two. You can leave this page open.</p>
    </div>
  );
}
