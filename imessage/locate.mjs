// Native iMessage location (Find My) from the project's Photon line, through Photon's low-level iMessage kit
// (https://photon.codes/docs/advanced-kits/imessage/locations). Spectrum does not expose locations, so this builds
// the same gRPC client the Spectrum iMessage provider builds from PROJECT_ID / PROJECT_SECRET.
//
//   node --env-file=.env locate.mjs request <address>   send the "share your location" card in the DM with <address>
//   node --env-file=.env locate.mjs get <address>       read the location <address> shares with the line
//
// <address> is an E.164 phone number or an Apple ID email. Prints one JSON line; never prints the address.
import { cloud } from "spectrum-ts";
import { createGrpcClient } from "@photon-ai/advanced-imessage/grpc";

const [cmd, address] = process.argv.slice(2);
const out = (o) => console.log(JSON.stringify(o));
if (!["request", "get"].includes(cmd) || !address) {
  out({ ok: false, error: "usage: locate.mjs request|get <address>" });
  process.exit(2);
}

/** The line's client. Shared mode (one Photon-owned number) routes by chat; dedicated mode has one host per number. */
async function lineClient() {
  const t = await cloud.issueImessageTokens(process.env.PROJECT_ID, process.env.PROJECT_SECRET);
  if (t.type === "shared") {
    const host = process.env.SPECTRUM_IMESSAGE_ADDRESS ?? "imessage.spectrum.photon.codes:443";
    return { mode: "shared", client: createGrpcClient({ address: host, token: t.token, tls: true, retry: true }) };
  }
  const [id] = Object.keys(t.auth ?? {});
  if (!id) throw new Error("no iMessage line on this Photon project");
  return { mode: "dedicated", client: createGrpcClient({ address: `${id}.imsg.photon.codes:443`, token: t.auth[id], tls: true, retry: true }) };
}

const { mode, client } = await lineClient();
try {
  if (cmd === "request") {
    const chat = mode === "shared" ? `any;-;${address}` : (await client.chats.create([address])).chat.guid;
    const r = await client.locations.request(chat, address);
    out({ ok: true, mode, status: r.status, reason: r.reason ?? null, card: Boolean(r.messageGuid) });
  } else {
    const l = await client.locations.get(address);
    out({
      ok: true, mode, type: l.locationType, locating: l.isLocatingInProgress,
      lat: l.latitude ?? null, lon: l.longitude ?? null, accuracy_m: l.accuracy ?? null,
      at: l.locationTimestamp ?? null, short: l.shortAddress ?? null, long: l.longAddress ?? null,
    });
  }
} catch (e) {
  out({ ok: false, mode, error: `${e?.constructor?.name ?? "Error"}: ${String(e?.message ?? e).replace(/\+\d{6,}/g, "+…").replace(/[\w.+-]+@[\w.-]+/g, "…@…")}` });
  process.exitCode = 1;
} finally {
  await client.close();
}
