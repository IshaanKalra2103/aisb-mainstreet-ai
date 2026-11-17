"use client";
import { useState } from "react";

/**
 * The Sandbox: a browser-style window where an owner sees a tool at work.
 *   Preview       the recorded video of the tool (on a copy of their website, or AI-generated).
 *   Try it live   experimental: the real tool we set up, working, embedded here. Only Chatling for now
 *                 (its share page allows embedding), and the window says so.
 * Phone: full width, the live tool is sized to the screen (at most 62% of its height).
 */
export default function Sandbox({ name, video, videoNote, live }: {
  name: string; video?: string | null; videoNote?: string; live?: string | null;
}) {
  const [mode, setMode] = useState<"preview" | "live">(live && !video ? "live" : "preview");
  const showing = mode === "live" && live ? "live" : "preview";
  const host = (() => { try { return new URL(live ?? "").host; } catch { return ""; } })();
  return (
    <figure data-testid="sandbox" className="overflow-hidden rounded-2xl border border-line bg-[#141518]">
      <figcaption className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
        <span aria-hidden className="flex gap-1.5"><i className="size-2.5 rounded-full bg-white/20" /><i className="size-2.5 rounded-full bg-white/20" /><i className="size-2.5 rounded-full bg-white/20" /></span>
        <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-[#141518]">Sandbox</span>
        {video && live && (
          <span role="tablist" aria-label={`${name} in the sandbox`} className="ml-auto flex rounded-full bg-white/10 p-0.5 text-sm font-semibold">
            <button type="button" role="tab" aria-selected={showing === "preview"} onClick={() => setMode("preview")}
              className={`rounded-full px-3 py-1 ${showing === "preview" ? "bg-white text-[#141518]" : "text-white/80"}`}>Preview</button>
            <button type="button" role="tab" aria-selected={showing === "live"} onClick={() => setMode("live")}
              className={`rounded-full px-3 py-1 ${showing === "live" ? "bg-white text-[#141518]" : "text-white/80"}`}>Try it live</button>
          </span>
        )}
        {showing === "live" && !video && <span className="ml-auto truncate text-sm text-white/60">{host}</span>}
      </figcaption>
      {showing === "live" && live ? (
        <iframe src={live} title={`${name}, live in the sandbox`} loading="lazy" data-testid="sandbox-live"
          className="block h-[min(520px,62dvh)] w-full border-0 bg-white" />
      ) : video ? (
        <video src={video} autoPlay muted controls playsInline loop
          className="block w-full h-auto max-h-[62dvh] aspect-[auto_16/9] bg-black object-contain" />
      ) : null}
      <p className="border-t border-white/10 px-3.5 py-2.5 text-sm leading-snug text-white/70">
        {showing === "live"
          ? <><span className="font-semibold text-accent">Experimental.</span> This is the real {name} we set up for you. Try it like a customer would. Trying tools live works only for Chatling for now.</>
          : <>{videoNote ?? `A preview of ${name}.`} <span className="text-white/50">Trying a tool live here is experimental and works only for Chatling for now.</span></>}
      </p>
    </figure>
  );
}
