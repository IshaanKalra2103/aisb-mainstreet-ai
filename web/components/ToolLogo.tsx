"use client";
import { useState } from "react";
import { toolLogo } from "@/lib/places";

/**
 * The tool's site icon. Hidden when the site has none: the icon service then answers with a 16 px placeholder
 * (or nothing), which reads as an empty box.
 */
export default function ToolLogo({ url, className }: { url: string; className: string }) {
  const [hidden, setHidden] = useState(false);
  const src = toolLogo(url);
  if (!src || hidden) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img data-testid="tool-logo" src={src} alt="" aria-hidden loading="lazy" className={className}
      onError={() => setHidden(true)} onLoad={(e) => { if (e.currentTarget.naturalWidth <= 16) setHidden(true); }} />
  );
}
