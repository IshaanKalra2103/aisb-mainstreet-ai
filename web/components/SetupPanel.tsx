"use client";
import { useState } from "react";
import type { OwnerBundle } from "@/lib/types";
import { toolById } from "@/lib/catalog";
import { ApiError, decide } from "@/lib/api";

export const HELPERS = [
  { name: "Maryland SBDC", url: "https://www.marylandsbdc.org", short: "Free one-on-one business advice.", what: "Free one-on-one business advice from the Maryland Small Business Development Center." },
  { name: "SCORE", url: "https://www.score.org/find-mentor", short: "Free mentors who ran a business.", what: "Free mentors who have run their own businesses." },
  { name: "SBA Baltimore District Office", url: "https://www.sba.gov/district/baltimore", short: "The U.S. small business office.", what: "The U.S. Small Business Administration office that serves Maryland." },
];

const LINK_TEXT: Record<string, string> = { booking_page: "Your booking page", chat_page: "Your chat page" };

const STATUS_TEXT: Record<string, string> = {
  planned: "Planned",
  awaiting_approval: "Waiting for your OK",
  running: "Setting it up now",
  needs_owner: "We need you for one step",
  done: "Done",
  failed: "This did not work",
};

/**
 * The owner's yes or no on a setup. "Not now" answers at once and stays changeable: a declined approval shows
 * "Changed your mind?" with the yes button (the same works from the iMessage poll). A yes is final.
 * `onChange` reloads the page's records after a "not now" (a yes starts a turn, which `onTurn` follows).
 */
export function Approval({ ownerId, a, onTurn, onChange }: {
  ownerId: string; a: OwnerBundle["approvals"][number]; onTurn: (id: string) => void; onChange?: () => void;
}) {
  const [state, setState] = useState<"idle" | "busy" | "sent" | "declined" | "already" | "error">(a.status === "rejected" ? "declined" : "idle");
  const [already, setAlready] = useState("");
  const [problem, setProblem] = useState("");
  const name = toolById(a.tool_id)?.name ?? a.tool_id;
  const go = async (d: "approve" | "reject") => {
    setState("busy");
    try {
      const r = await decide(ownerId, a.id, d);
      if (r.already) {
        setAlready(/approved/i.test(r.already) ? "You already said yes to this." : /rejected/i.test(r.already) ? "You already said not now to this." : "You already answered this.");
        setState("already");
      }
      else if (r.turn_id) { setState("sent"); onTurn(r.turn_id); }
      else { setState("declined"); onChange?.(); }
    } catch (e) {
      // A 429 ("still working on your last message") leaves the approval as it was, so the buttons stay usable.
      setProblem(e instanceof ApiError ? e.message : "That did not go through. Please try again in a minute.");
      setState(a.status === "rejected" ? "declined" : "error");
    }
  };
  const declined = state === "declined";
  const open = state === "idle" || state === "error" || declined;
  return (
    <div className="rounded-2xl p-5 bg-raised border border-line">
      <h3 className="text-xl font-semibold">{declined ? `Not now for ${name}` : `Ready to set up ${name}`}</h3>
      <p className="mt-2 text-muted">{declined ? "Nothing gets set up. Changed your mind? Say yes and we start." : a.summary}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button className="btn btn-primary" disabled={!open} onClick={() => go("approve")}>Yes, set it up</button>
        {!declined && <button className="btn btn-secondary" disabled={!open} onClick={() => go("reject")}>Not now</button>}
      </div>
      {declined && problem && <p role="alert" className="mt-3 text-brick font-semibold">{problem}</p>}
      {state === "sent" && <p className="mt-3 text-accent-dark font-semibold">Thank you. We are on it.</p>}
      {state === "already" && <p className="mt-3 font-semibold">{already}</p>}
      {state === "error" && <p role="alert" className="mt-3 text-brick font-semibold">{problem}</p>}
    </div>
  );
}

/** One setup and where it stands. `liveLink` adds a link to the agent's live browser (the owner page embeds it instead). */
export function SetupRecordView({ s, liveLink = true }: { ownerId: string; s: OwnerBundle["setups"][string]; live: boolean; liveLink?: boolean }) {
  const name = toolById(s.tool_id)?.name ?? s.tool_id;
  return (
    <div className="rounded-2xl p-5 bg-raised border border-line">
      <p className="eyebrow">{name}</p>
      <h3 className="text-xl font-semibold mt-1">{STATUS_TEXT[s.status] ?? s.status}</h3>
      {s.status === "needs_owner" && s.handoff_reason && <p className="mt-2">{s.handoff_reason}</p>}
      {liveLink && s.streaming_url?.startsWith("http") && s.status !== "done" && (
        <p className="mt-2"><a href={s.streaming_url} target="_blank" rel="noopener noreferrer">Watch live</a></p>
      )}
      {Object.entries(s.links ?? {}).filter(([, u]) => /^https?:\/\//i.test(u)).map(([k, u]) => (
        <p key={k} className="mt-3 text-lg font-semibold">
          <a href={u} target="_blank" rel="noopener noreferrer">{LINK_TEXT[k] ?? "Open it"}</a>
        </p>
      ))}
      {s.configured.length > 0 && (
        <div className="mt-4"><p className="font-semibold">What we set up</p><ul className="list-disc pl-5">{s.configured.map((c) => <li key={c}>{c}</li>)}</ul></div>
      )}
      {s.next_steps.length > 0 && (
        <div className="mt-4"><p className="font-semibold">What is next for you</p><ol className="list-decimal pl-5">{s.next_steps.map((c) => <li key={c}>{c}</li>)}</ol></div>
      )}
    </div>
  );
}

export default function SetupPanel({ ownerId, bundle, live, onTurn }: { ownerId: string; bundle: OwnerBundle; live: boolean; onTurn: (id: string) => void }) {
  const pending = bundle.approvals.filter((a) => a.status === "pending");
  const records = Object.values(bundle.setups);
  return (
    <div className="grid gap-4">
      {live && pending.map((a) => <Approval key={a.id} ownerId={ownerId} a={a} onTurn={onTurn} />)}
      {records.map((s) => <SetupRecordView key={s.tool_id} ownerId={ownerId} s={s} live={live} />)}
      {!live && records.length === 0 && <p className="text-soft">In a live session, we can set a tool up for you after you say yes.</p>}
      <div className="card p-5">
        <h3 className="text-xl font-semibold">Find me a local helper</h3>
        <p className="mt-1 text-soft">Prefer a real person? These public organizations help Maryland small businesses, often for free.</p>
        <ul className="mt-3 grid gap-3 sm:grid-cols-3">
          {HELPERS.map((h) => (
            <li key={h.name}>
              <a href={h.url} target="_blank" rel="noopener noreferrer" className="font-semibold">{h.name}</a>
              <p className="text-base text-soft">{h.what}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
