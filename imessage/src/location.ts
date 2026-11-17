// Native iMessage location through Photon's Find My kit (https://photon.codes/docs/advanced-kits/imessage/locations).
// Spectrum does not expose it, so this builds the same low-level client Spectrum's iMessage provider builds from the
// project's PROJECT_ID / PROJECT_SECRET: one shared Photon line, or the project's dedicated line.
//
// request() sends the "share your location" card in the owner's DM; wait() polls until the owner shares.
// Nothing here logs an address or a location.
import { cloud } from "spectrum-ts";
import { createGrpcClient } from "@photon-ai/advanced-imessage/grpc";
import type { SharedSpot } from "./relay.ts";

export const PENDING_MS = 15 * 60_000; // one request per owner per 15 minutes
export const POLL_MS = 10_000;

type Client = ReturnType<typeof createGrpcClient>;

export function locationKit(projectId: string, projectSecret: string) {
  let token: { value: string; until: number } | null = null;
  let client: Promise<Client> | null = null;
  const pending = new Map<string, number>();

  /** A token for this project's line, minted again a minute before it runs out. */
  async function mint(): Promise<{ type: string; value: string; instance?: string }> {
    const t: any = await cloud.issueImessageTokens(projectId, projectSecret);
    const until = Date.now() + Math.max(60, Number(t.expiresIn) || 600) * 1000 - 60_000;
    if (t.type === "shared") {
      token = { value: t.token, until };
      return { type: "shared", value: t.token };
    }
    const [instance, value] = Object.entries<string>(t.auth ?? {})[0] ?? [];
    if (!instance || !value) throw new Error("no iMessage line on this Photon project");
    token = { value, until };
    return { type: "dedicated", value, instance };
  }

  function lineClient(): Promise<Client> {
    client ??= mint().then((first) =>
      createGrpcClient({
        address:
          first.type === "shared"
            ? (process.env.SPECTRUM_IMESSAGE_ADDRESS ?? "imessage.spectrum.photon.codes:443")
            : `${first.instance}.imsg.photon.codes:443`,
        tls: true,
        retry: true,
        token: async () => (token && Date.now() < token.until ? token.value : (await mint()).value),
      }),
    );
    client.catch(() => (client = null)); // a failed mint is retried on the next request
    return client;
  }

  return {
    /** Send the Find My request card in the DM `chat` (the Spectrum space id) to `who`. */
    async request(chat: string, who: string): Promise<"sent" | "pending" | "failed"> {
      if ((pending.get(who) ?? 0) > Date.now()) return "pending";
      try {
        const r = await (await lineClient()).locations.request(chat, who);
        if (r.status !== "sent" && !r.messageGuid) return "failed"; // "sent" is the only status seen so far
        pending.set(who, Date.now() + PENDING_MS);
        return "sent";
      } catch {
        return "failed";
      }
    },

    /** Poll until `who` shares a spot with coordinates, or PENDING_MS passes. */
    async wait(who: string, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<SharedSpot | null> {
      const end = Date.now() + PENDING_MS;
      try {
        while (Date.now() < end) {
          try {
            const l = await (await lineClient()).locations.get(who);
            if (typeof l.latitude === "number" && typeof l.longitude === "number") {
              return { lat: l.latitude, lon: l.longitude, acc: typeof l.accuracy === "number" ? l.accuracy : 100 };
            }
          } catch {
            /* not sharing yet */
          }
          await sleep(POLL_MS);
        }
        return null;
      } finally {
        pending.delete(who);
      }
    },
  };
}
