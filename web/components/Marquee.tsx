/** Things an owner could text us, drifting by (Tomo's bubble marquee). Pauses on hover; still under reduced motion. */
const ROWS = [
  ["can you answer calls after 6?", "reply to my new google reviews", "post today's special on instagram", "who's booked for saturday?",
    "remind people about their appointments", "update my holiday hours"],
  ["chase the two unpaid invoices", "send the hendersons a quote", "what are people saying about us?", "make a flyer for the sidewalk sale",
    "text me when the order is late", "fix the menu on my site"],
];

export default function Marquee() {
  return (
    <div className="ob-marquee" aria-label="Things owners text us">
      {ROWS.map((row, r) => (
        <div key={r} className={`ob-track${r ? " rev" : ""}`} style={{ ["--ob-speed" as string]: r ? "84s" : "72s" }}>
          {[...row, ...row].map((t, i) => <span key={i} aria-hidden={i >= row.length || undefined}>{t}</span>)}
        </div>
      ))}
    </div>
  );
}
