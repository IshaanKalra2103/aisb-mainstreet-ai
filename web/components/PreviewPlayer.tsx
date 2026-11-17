import type { OwnerBundle } from "@/lib/types";
import { toolById } from "@/lib/catalog";
import { mediaUrl } from "@/lib/api";

type P = OwnerBundle["previews"][string];

/**
 * What a preview is, in one honest sentence. Clips saved before the "shop" kind existed were all marked "site"; one
 * with a Veo opener is the in-shop view (an opener is only ever joined in front of it).
 */
export function previewCaption(p: Pick<P, "kind" | "prompt">, name: string): string {
  const kind = p.kind === "site" && /opener/i.test(p.prompt ?? "") ? "shop" : p.kind;
  if (kind === "site") return `Preview of ${name} on a copy of your website.`;
  if (kind === "shop") {
    return /opener/i.test(p.prompt ?? "")
      ? `Preview of ${name} on its own screen in your shop. The opening shot of your shop is AI-generated.`
      : `Preview of ${name} on its own screen in your shop.`;
  }
  return `AI-generated preview of how ${name} would work in your business.`;
}

export default function PreviewPlayer({ preview }: { preview: P }) {
  const tool = toolById(preview.tool_id);
  const name = tool?.name ?? preview.tool_id;
  const src = mediaUrl(preview.video_url);
  if (preview.status !== "completed" || !src) {
    return (
      <p className="card p-5">
        {preview.status === "capped"
          ? `We have reached today's limit for preview videos, so there is no preview of ${name} yet.`
          : `We could not make a preview of ${name} this time.`}
      </p>
    );
  }
  return (
    <figure className="card p-4 sm:p-5">
      <video src={`${src}#t=0.5`} muted controls playsInline preload="metadata" className="w-full rounded-2xl bg-black max-h-[70vh]" />
      <figcaption className="mt-3 text-base text-soft">
        {previewCaption(preview, name)}
      </figcaption>
    </figure>
  );
}
