// The MainStreet AI chat wallpaper (Photon's chats.setBackground; iMessage only). The relay tries each thread once per
// run, the first time it hears from it, and leaves a thread alone when it already has a background, so an owner who
// picked their own keeps it. Nothing here logs a chat id or an address.
import type { createGrpcClient } from "@photon-ai/advanced-imessage/grpc";

type Client = ReturnType<typeof createGrpcClient>;

export function chatBackground(line: () => Promise<Client>, image: Uint8Array) {
  const tried = new Set<string>();
  /** Set the wallpaper on `chat` (the Spectrum space id) if it has none. Never throws. */
  return async function apply(chat: string): Promise<"set" | "kept" | "skipped" | "failed"> {
    if (tried.has(chat)) return "skipped";
    tried.add(chat); // one try per thread per run, so a failing line is not asked again on every text
    try {
      const c = await line();
      if (await c.chats.hasBackground(chat)) return "kept";
      await c.chats.setBackground(chat, image);
      return "set";
    } catch (e) {
      console.error(`[relay] chat background failed: ${e instanceof Error ? e.name : typeof e}`);
      return "failed";
    }
  };
}
