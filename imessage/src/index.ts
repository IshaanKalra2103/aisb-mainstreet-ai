// MainStreet AI iMessage relay: Photon line -> POST /api/imessage -> replies back to the thread.
// All message logic lives in relay.ts; this file only wires Photon to it.
//
//   AGENT_API_URL=http://127.0.0.1:8787 MS_RELAY_SECRET=... npm start
//
// Only one consumer may read the Photon line. Stop any other (e.g. the old gtm-paperclip
// container) first, or both will reply.
// Docs: https://photon.codes/docs/spectrum-ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Spectrum, app as appCard, attachment, poll, richlink } from "spectrum-ts";
import { imessage } from "@spectrum-ts/imessage";
import {
  handleMessage, hashSender, Outbox, PUSH_INTERVAL_MS, PUSH_WINDOW_MS, relayable, type RelayDeps, timeoutFromEnv, votable,
} from "./relay.ts";
import { locationKit } from "./location.ts";

const apiUrl = process.env.AGENT_API_URL || "http://127.0.0.1:8787";
const secret = process.env.MS_RELAY_SECRET || undefined;
const timeoutMs = timeoutFromEnv(process.env.RELAY_TIMEOUT_MS);
const projectId = process.env.PROJECT_ID;
const projectSecret = process.env.PROJECT_SECRET;

if (!projectId || !projectSecret) {
  console.error("[relay] PROJECT_ID / PROJECT_SECRET missing. Put them in imessage/.env (from the Photon dashboard).");
  process.exit(1);
}
if (!secret) console.warn("[relay] MS_RELAY_SECRET is not set; the API will reject calls if it has one.");

const app = await Spectrum({
  projectId,
  projectSecret,
  providers: [imessage.config()],
  options: { logLevel: "warn" },
});

let stopping = false;
const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  console.log(`[relay] ${signal}, stopping`);
  await app.stop().catch(() => {});
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

// Native "share your location" card in place of the share page card. RELAY_NATIVE_LOCATION=0 turns it off.
const location = process.env.RELAY_NATIVE_LOCATION === "0" ? null : locationKit(projectId, projectSecret);

// Texting first (website yes, finished setups): the thread of each phone that texted since start, by sender hash.
// Lost on restart until that phone texts again. RELAY_PUSH=0 turns it off; RELAY_PUSH_WINDOW_MS is how long after a
// phone's last text we keep polling (every poll through the GCP waker can start the agent VM).
// AGENT_DIRECT_URL (the agent VM's internal address on GCP) cannot start the VM, so the relay polls it all the time
// with a short timeout: a number added on the website is texted first even when nobody texted lately. Texts the
// relay posts still go to AGENT_API_URL, which wakes the VM.
const directUrl = process.env.AGENT_DIRECT_URL || undefined;
const threads = new Map<string, RelayDeps>();
const im = imessage(app);
const outbox = process.env.RELAY_PUSH === "0" ? null : new Outbox({
  apiUrl: directUrl ?? apiUrl,
  secret,
  fetch: (url, init) => fetch(url, init),
  thread: (h) => threads.get(h),
  intervalMs: timeoutFromEnv(process.env.RELAY_PUSH_INTERVAL_MS) ?? PUSH_INTERVAL_MS,
  windowMs: timeoutFromEnv(process.env.RELAY_PUSH_WINDOW_MS) ?? PUSH_WINDOW_MS,
  ...(directUrl && { always: true, timeoutMs: 5_000 }),
  open: async (to, h) => {
    const deps = threadDeps(await im.space.create(await im.user(to)));
    threads.set(h, deps);
    return deps;
  },
});
if (outbox) void outbox.run();

console.log(`[relay] listening, agent API ${apiUrl}, native location ${location ? "on" : "off"}, push ${outbox ? (directUrl ? "on (direct, always)" : "on") : "off"}`);

// Each message is handled on its own so a slow turn (up to ~280 s) never blocks other senders.
for await (const [space, message] of app.messages) {
  const deps = threadDeps(space);
  const who = relayable(message)?.senderId ?? votable(message)?.senderId;
  if (who) {
    threads.set(hashSender(who), deps);
    outbox?.touch();
  }
  void handleMessage(message, deps)
    .catch((e) => console.error(`[relay] handler crashed: ${e instanceof Error ? e.name : typeof e}`));
}
console.error("[relay] Photon message stream ended");
process.exit(1);

/** Everything the relay needs to text back into one thread. */
function threadDeps(space: any): RelayDeps {
  return {
    apiUrl,
    secret,
    timeoutMs,
    fetch: (url, init) => fetch(url, init),
    send: (text) => space.send(text),
    sendLink: (url) => space.send(richlink(url)),
    sendCard: (url, layout) => space.send(appCard(url, { layout })),
    sendPoll: (question, options) => space.send(poll(question, ...options)),
    sendVideo: async (bytes, name) => {
      const dir = await mkdtemp(join(tmpdir(), "ms-video-"));
      try {
        const file = join(dir, name);
        await writeFile(file, bytes);
        await space.send(attachment(file));
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    typing: (on) => (on ? space.startTyping() : space.stopTyping()),
    ...(location && {
      requestLocation: (who: string) => location.request(space.id, who),
      waitLocation: (who: string) => location.wait(who),
      lateLocation: (who: string) => location.late(who),
    }),
  };
}
