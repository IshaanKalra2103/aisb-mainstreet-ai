// Texting first: the relay polls GET /api/imessage/outbox while a phone is recent and sends each entry to its thread.
import assert from "node:assert/strict";
import { test } from "node:test";
import { GAP_MS, hashSender, Outbox, type OutboxDeps, PUSH_WINDOW_MS, type RelayDeps } from "../src/relay.ts";

const PHONE = "+14105550123";
const H = hashSender(PHONE);
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function harness(pages: Array<Response | Error>, over: Partial<OutboxDeps> = {}) {
  const urls: string[] = [];
  const heads: Array<Record<string, string>> = [];
  const events: string[] = [];
  const logs: string[] = [];
  let clock = 1_000_000;
  const thread: RelayDeps = {
    apiUrl: "http://api.test",
    fetch: async () => json(404, {}), // planCard reads the owner: none here, so the page goes as a link
    send: async (t) => void events.push(`send:${t}`),
    sendLink: async (u) => void events.push(`link:${u}`),
    sendPoll: async (q, o) => void events.push(`poll:${q}|${o.join("/")}`),
    sleep: async (ms) => void events.push(`sleep:${ms}`),
    log: (l) => void logs.push(l),
  };
  const box = new Outbox({
    apiUrl: "http://api.test/",
    secret: "s3cret",
    fetch: async (url, init) => {
      urls.push(url);
      heads.push(init.headers as Record<string, string>);
      const next = pages.shift();
      if (!next) return json(200, { epoch: "e1", next: 0, busy: false, entries: [] });
      if (next instanceof Error) throw next;
      return next;
    },
    thread: (h) => (h === H ? thread : undefined),
    now: () => clock,
    log: (l) => void logs.push(l),
    ...over,
  });
  return { box, urls, heads, events, logs, tick: (ms: number) => void (clock += ms) };
}

const entry = (over: Record<string, unknown> = {}) => ({
  id: 3, from_hash: H, replies: ["Got your yes on the website. Setting up Chatling now."], links: [], video_url: null, poll: null, ...over,
});

test("no phone has texted: no polling at all (each poll can wake the GCP VM)", async () => {
  const h = harness([]);
  assert.equal(await h.box.tick(), 0);
  assert.deepEqual(h.urls, []);
});

test("the first poll only takes the cursor, then entries after it go to the phone's thread", async () => {
  const h = harness([
    json(200, { epoch: "e1", next: 2, busy: false, entries: [entry({ id: 2 })] }),
    json(200, { epoch: "e1", next: 3, busy: false, entries: [entry({ links: ["https://web.test/b/o_abcdef1234"] })] }),
  ]);
  h.box.touch();
  assert.equal(await h.box.tick(), 0, "nothing old is replayed");
  assert.equal(h.urls[0], "http://api.test/api/imessage/outbox");
  assert.equal(h.heads[0]!["x-relay-secret"], "s3cret");
  assert.deepEqual(h.events, []);

  assert.equal(await h.box.tick(), 1);
  assert.equal(h.urls[1], "http://api.test/api/imessage/outbox?after=2&epoch=e1");
  assert.deepEqual(h.events, [
    "send:Got your yes on the website. Setting up Chatling now.", `sleep:${GAP_MS}`, "link:https://web.test/b/o_abcdef1234",
  ]);
  assert.equal(h.urls.length, 2);
});

test("a poll in the entry goes out last; texts are paced like replies", async () => {
  const h = harness([
    json(200, { epoch: "e1", next: 0, busy: false, entries: [] }),
    json(200, { epoch: "e1", next: 1, busy: false, entries: [entry({ replies: ["a", "b"], poll: { question: "Set up Chatling for you?", options: ["Yes, set it up", "Not now"] } })] }),
  ]);
  h.box.touch();
  await h.box.tick();
  await h.box.tick();
  assert.deepEqual(h.events, ["send:a", `sleep:${GAP_MS}`, "send:b", `sleep:${GAP_MS}`, "poll:Set up Chatling for you?|Yes, set it up/Not now"]);
});

test("an entry for a phone this relay has not heard from is skipped and logged without the hash in full", async () => {
  const other = "b".repeat(64);
  const h = harness([
    json(200, { epoch: "e1", next: 0, busy: false, entries: [] }),
    json(200, { epoch: "e1", next: 1, busy: false, entries: [entry({ from_hash: other })] }),
  ]);
  h.box.touch();
  await h.box.tick();
  assert.equal(await h.box.tick(), 0);
  assert.deepEqual(h.events, []);
  assert.ok(h.logs.some((l) => l.includes("bbbbbbbbbbbb skipped")));
  assert.ok(!h.logs.some((l) => l.includes(other)));
});

test("the window closes 30 min after the last text, and reopening syncs the cursor again", async () => {
  const h = harness([
    json(200, { epoch: "e1", next: 4, busy: false, entries: [] }),
    json(200, { epoch: "e1", next: 9, busy: false, entries: [] }),
  ]);
  h.box.touch();
  await h.box.tick();
  h.tick(PUSH_WINDOW_MS);
  assert.equal(h.box.active, false);
  await h.box.tick();
  assert.equal(h.urls.length, 1, "no poll once the window is closed");
  h.box.touch();
  await h.box.tick();
  assert.equal(h.urls[1], "http://api.test/api/imessage/outbox", "a fresh sync, not after=4");
});

test("busy (a texting owner's turn is running) keeps the window open", async () => {
  const h = harness([json(200, { epoch: "e1", next: 0, busy: true, entries: [] })]);
  h.box.touch();
  h.tick(PUSH_WINDOW_MS - 1);
  await h.box.tick();
  h.tick(PUSH_WINDOW_MS - 1);
  assert.equal(h.box.active, true);
});

test("a delivered push keeps the window open too", async () => {
  const h = harness([
    json(200, { epoch: "e1", next: 0, busy: false, entries: [] }),
    json(200, { epoch: "e1", next: 1, busy: false, entries: [entry()] }),
  ]);
  h.box.touch();
  await h.box.tick();
  h.tick(PUSH_WINDOW_MS - 1);
  await h.box.tick();
  h.tick(PUSH_WINDOW_MS - 1);
  assert.equal(h.box.active, true);
});

test("a failing poll is logged once per kind, never throws, and recovery is logged", async () => {
  const h = harness([json(502, {}), json(502, {}), new TypeError("fetch failed"), json(200, { epoch: "e1", next: 0, busy: false, entries: [] })]);
  h.box.touch();
  for (let i = 0; i < 4; i++) assert.equal(await h.box.tick(), 0);
  assert.deepEqual(h.logs, ["[push] poll failed: http 502", "[push] poll failed: TypeError", "[push] poll ok again"]);
});

test("a new API epoch (restart or VM wake) keeps polling from the cursor it returns", async () => {
  const h = harness([
    json(200, { epoch: "e1", next: 7, busy: false, entries: [] }),
    json(200, { epoch: "e2", next: 1, busy: false, entries: [entry({ id: 1 })] }),
    json(200, { epoch: "e2", next: 1, busy: false, entries: [] }),
  ]);
  h.box.touch();
  await h.box.tick();
  assert.equal(await h.box.tick(), 1, "the API sends everything in its new outbox");
  await h.box.tick();
  assert.equal(h.urls[2], "http://api.test/api/imessage/outbox?after=1&epoch=e2");
});

test("logs never carry the phone number or the message text", async () => {
  const h = harness([
    json(200, { epoch: "e1", next: 0, busy: false, entries: [] }),
    json(200, { epoch: "e1", next: 1, busy: false, entries: [entry()] }),
  ]);
  h.box.touch();
  await h.box.tick();
  await h.box.tick();
  for (const l of h.logs) {
    assert.ok(!l.includes(PHONE) && !l.includes("Chatling"), l);
  }
  assert.match(h.logs.at(-1)!, /^\[push\] [0-9a-f]{12} texts=1 links=0 video=0 poll=0 \d+\.\ds$/);
});
