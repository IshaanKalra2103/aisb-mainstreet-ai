// Unit tests for the relay handler: fake fetch, send and sleep, no Photon, no network.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { GAP_MS, handleMessage, hashSender, type IncomingLike, type RelayDeps, SORRY } from "../src/relay.ts";

const PHONE = "+14105550123";
const TEXT = "I run a hair salon in Westminster MD, what AI could help me?";
const msg = (over: Partial<IncomingLike> = {}): IncomingLike => ({
  direction: "inbound",
  sender: { id: PHONE },
  content: { type: "text", text: TEXT },
  ...over,
});

type Call = { url: string; init: RequestInit };

function harness(respond: (call: Call) => Response | Promise<Response>, over: Partial<RelayDeps> = {}) {
  const calls: Call[] = [];
  const events: string[] = []; // sends and sleeps, in order
  const logs: string[] = [];
  const deps: RelayDeps = {
    apiUrl: "http://api.test/",
    secret: "s3cret",
    fetch: async (url, init) => {
      const call = { url, init };
      calls.push(call);
      return respond(call);
    },
    send: async (t) => void events.push(`send:${t}`),
    sleep: async (ms) => void events.push(`sleep:${ms}`),
    log: (l) => void logs.push(l),
    ...over,
  };
  return { deps, calls, events, logs };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("hashSender is sha256 hex of the sender id", () => {
  assert.equal(hashSender(PHONE), createHash("sha256").update(PHONE).digest("hex"));
  assert.match(hashSender(PHONE), /^[0-9a-f]{64}$/);
});

test("posts {from_hash, text} with the relay secret, then sends replies 3 s apart and the link", async () => {
  const h = harness(() => json(200, { replies: ["one", "two"], link: "https://web.test/b/o_abc" }));
  assert.equal(await handleMessage(msg(), h.deps), "replied");

  assert.equal(h.calls.length, 1);
  const { url, init } = h.calls[0]!;
  assert.equal(url, "http://api.test/api/imessage");
  assert.equal(init.method, "POST");
  const headers = init.headers as Record<string, string>;
  assert.equal(headers["x-relay-secret"], "s3cret");
  assert.equal(headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(init.body as string), { from_hash: hashSender(PHONE), text: TEXT });
  assert.ok(init.signal instanceof AbortSignal, "the call has a timeout signal");

  assert.deepEqual(h.events, [
    "send:one", `sleep:${GAP_MS}`, "send:two", `sleep:${GAP_MS}`, "send:https://web.test/b/o_abc",
  ]);
  assert.equal(GAP_MS, 3000);
});

test("no secret header when no secret is configured", async () => {
  const h = harness(() => json(200, { replies: ["hi"], link: "L" }), { secret: undefined });
  await handleMessage(msg(), h.deps);
  assert.equal((h.calls[0]!.init.headers as Record<string, string>)["x-relay-secret"], undefined);
});

test("keeps at most 3 replies and trims blanks", async () => {
  const h = harness(() => json(200, { replies: ["a", " ", "b", "c", "d"], link: "L" }));
  await handleMessage(msg(), h.deps);
  assert.deepEqual(h.events.filter((e) => e.startsWith("send:")), ["send:a", "send:b", "send:c", "send:L"]);
});

test("a 429 sends its detail text", async () => {
  const h = harness(() => json(429, { detail: "Give me a few seconds between texts." }));
  assert.equal(await handleMessage(msg(), h.deps), "rate_limited");
  assert.deepEqual(h.events, ["send:Give me a few seconds between texts."]);
});

for (const [name, respond] of [
  ["a 500", () => json(500, { detail: "Internal Server Error" })],
  ["a 401 (wrong relay secret)", () => json(401, { detail: "Unknown relay" })],
  ["a 422", () => json(422, { detail: [{ msg: "bad" }] })],
  ["a 429 without detail", () => json(429, {})],
  ["a non-JSON 200", () => new Response("<html>", { status: 200 })],
  ["a 200 with the wrong shape", () => json(200, { reply: "x" })],
  ["a 200 with nothing to send", () => json(200, { replies: [], link: "" })],
  ["a network error", () => Promise.reject(new TypeError("fetch failed"))],
  ["a timeout", () => Promise.reject(new DOMException("The operation timed out.", "TimeoutError"))],
] as const) {
  test(`${name} sends the sorry text`, async () => {
    const h = harness(respond as () => Response | Promise<Response>);
    assert.equal(await handleMessage(msg(), h.deps), "error");
    assert.deepEqual(h.events, [`send:${SORRY}`]);
  });
}

test("ignores our own outgoing messages, non-text, empty text and unknown senders", async () => {
  const cases: IncomingLike[] = [
    msg({ direction: "outbound" }),
    msg({ sender: { id: "+15550000000", kind: "agent" } }),
    msg({ content: { type: "attachment" } }),
    msg({ content: { type: "reaction", text: "love" } }),
    msg({ content: { type: "text", text: "   " } }),
    msg({ sender: undefined }),
    msg({ sender: { id: "" } }),
  ];
  for (const c of cases) {
    const h = harness(() => json(200, { replies: ["x"], link: "L" }));
    assert.equal(await handleMessage(c, h.deps), "ignored");
    assert.equal(h.calls.length, 0);
    assert.deepEqual(h.events, []);
  }
});

test("long texts are cut to the API's 2000 characters", async () => {
  const h = harness(() => json(200, { replies: ["ok"], link: "L" }));
  await handleMessage(msg({ content: { type: "text", text: "x".repeat(5000) } }), h.deps);
  assert.equal(JSON.parse(h.calls[0]!.init.body as string).text.length, 2000);
});

test("logs carry only a hash prefix, never the number or the text", async () => {
  for (const respond of [
    () => json(200, { replies: ["ok"], link: "L" }),
    () => Promise.reject(new Error(`could not reach ${PHONE}: ${TEXT}`)),
  ]) {
    const h = harness(respond as () => Promise<Response>);
    await handleMessage(msg(), h.deps);
    assert.ok(h.logs.length >= 2);
    for (const line of h.logs) {
      assert.ok(!line.includes(PHONE) && !line.includes("4105550123"), `number leaked: ${line}`);
      assert.ok(!line.includes("salon"), `text leaked: ${line}`);
      assert.ok(line.includes(hashSender(PHONE).slice(0, 12)));
    }
  }
});

test("a failing send is logged and does not throw", async () => {
  const h = harness(() => json(200, { replies: ["a", "b"], link: "L" }), {
    send: async () => {
      throw new Error(`send to ${PHONE} failed`);
    },
  });
  assert.equal(await handleMessage(msg(), h.deps), "send_failed");
  assert.ok(h.logs.some((l) => l.startsWith("[send-fail]")));
  assert.ok(h.logs.every((l) => !l.includes(PHONE)));
});

test("typing indicator is on while waiting and off before sending; its errors are ignored", async () => {
  const order: string[] = [];
  const h = harness(
    () => {
      order.push("fetch");
      return json(200, { replies: ["a"], link: "L" });
    },
    {
      typing: async (on) => {
        order.push(on ? "typing-on" : "typing-off");
        throw new Error("UnsupportedError");
      },
      send: async (t) => void order.push(`send:${t}`),
    },
  );
  assert.equal(await handleMessage(msg(), h.deps), "replied");
  assert.deepEqual(order, ["typing-on", "fetch", "typing-off", "send:a", "send:L"]);
});

test("a typing call that never settles does not block the reply", async () => {
  const h = harness(() => json(200, { replies: ["a"], link: "L" }), {
    typing: (on) => (on ? new Promise(() => {}) : Promise.resolve()),
  });
  const started = Date.now();
  assert.equal(await handleMessage(msg(), h.deps), "replied");
  assert.ok(Date.now() - started < 4_500, "gave up on typing after ~3 s");
  assert.deepEqual(h.events, ["send:a", `sleep:${GAP_MS}`, "send:L"]);
});

test("links go out as link cards and a preview video as an attachment, after the texts", async () => {
  const sent: string[] = [];
  const h = harness(
    (c) =>
      c.url.endsWith("/media/o_abc/preview_x.mp4")
        ? new Response(new Uint8Array([1, 2, 3]))
        : json(200, { replies: ["one"], link: "P", links: ["P", "https://other.test"], video_url: "/media/o_abc/preview_x.mp4" }),
    {
      sendLink: async (u) => void h.events.push(`card:${u}`),
      sendVideo: async (b, n) => void sent.push(`${n}:${b.length}`),
    },
  );
  assert.equal(await handleMessage(msg(), h.deps), "replied");
  assert.deepEqual(h.events.filter((e) => !e.startsWith("sleep")), ["send:one", "card:P", "card:https://other.test"]);
  assert.deepEqual(sent, ["preview_x.mp4:3"]);
  assert.equal(h.calls[1]!.url, "http://api.test/media/o_abc/preview_x.mp4");
});

test("a failed video fetch is skipped, texts and cards still go", async () => {
  const sent: string[] = [];
  const h = harness(
    (c) => (c.url.includes("/media/") ? new Response("no", { status: 404 }) : json(200, { replies: ["one"], links: ["P"], video_url: "/media/o/preview_x.mp4" })),
    { sendLink: async (u) => void h.events.push(`card:${u}`), sendVideo: async () => void sent.push("v") },
  );
  assert.equal(await handleMessage(msg(), h.deps), "replied");
  assert.deepEqual(sent, []);
  assert.ok(h.events.includes("card:P"));
});

// Native location (Photon's Find My kit): the "Share your shop" card becomes a "share your location" request inside
// iMessage, and the shared spot goes to the agent in the share page's turn text.
const SHOP = "https://web.test/b/o_abc/shop";
const SPOT = { lat: 39.4143, lon: -77.4105, acc: 19.2 };

function locHarness(request: "sent" | "pending" | "failed", spot: typeof SPOT | null) {
  const bg: Promise<unknown>[] = [];
  const asked: string[] = [];
  const h = harness(
    (c) =>
      JSON.parse(c.init.body as string).text.startsWith("Here is my shop.")
        ? json(200, { replies: ["Got your spot. Bean & Brick, right on Market St?"], links: ["https://web.test/b/o_abc"] })
        : json(200, { replies: ["Where is your shop?"], links: [SHOP] }),
    {
      sendLink: async (u) => void h.events.push(`card:${u}`),
      requestLocation: async (who) => {
        asked.push(who);
        h.events.push("location-request");
        return request;
      },
      waitLocation: async () => spot,
      background: (p) => void bg.push(p),
    },
  );
  return { ...h, bg, asked };
}

test("the shop card becomes a native location request, and the shared spot goes to the agent", async () => {
  const h = locHarness("sent", SPOT);
  assert.equal(await handleMessage(msg(), h.deps), "replied");
  assert.deepEqual(h.asked, [PHONE]);
  assert.deepEqual(h.events.filter((e) => !e.startsWith("sleep")), ["send:Where is your shop?", "location-request"]);
  await Promise.all(h.bg);
  assert.equal(h.calls.length, 2);
  assert.deepEqual(JSON.parse(h.calls[1]!.init.body as string), {
    from_hash: hashSender(PHONE),
    text: "Here is my shop. Location: 39.41430, -77.41050 (within 20 m). Link: none",
  });
  assert.deepEqual(h.events.filter((e) => !e.startsWith("sleep")).slice(2), [
    "send:Got your spot. Bean & Brick, right on Market St?",
    "card:https://web.test/b/o_abc",
  ]);
});

test("a request already waiting on the owner is not sent or watched twice", async () => {
  const h = locHarness("pending", SPOT);
  await handleMessage(msg(), h.deps);
  await Promise.all(h.bg);
  assert.equal(h.calls.length, 1);
  assert.ok(!h.events.includes(`card:${SHOP}`));
});

test("if the location request fails, the share page card goes out as before", async () => {
  const h = locHarness("failed", SPOT);
  await handleMessage(msg(), h.deps);
  await Promise.all(h.bg);
  assert.ok(h.events.includes(`card:${SHOP}`));
  assert.equal(h.calls.length, 1);
});

test("an owner who never shares gets no extra texts", async () => {
  const h = locHarness("sent", null);
  await handleMessage(msg(), h.deps);
  await Promise.all(h.bg);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.events.filter((e) => !e.startsWith("sleep")), ["send:Where is your shop?", "location-request"]);
});

test("without the location kit, the shop card goes out as before", async () => {
  const h = harness(() => json(200, { replies: ["Where is your shop?"], links: [SHOP] }), {
    sendLink: async (u) => void h.events.push(`card:${u}`),
  });
  await handleMessage(msg(), h.deps);
  assert.ok(h.events.includes(`card:${SHOP}`));
});

// The owner's page goes out as an iMessage app card: street photo, shop name, and the plan in numbers.
const PAGE = "https://web.test/b/o_abc123";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PROFILE = { name: "Bean & Brick Coffee", business_type: "coffee_shop", city: "Frederick", state: "MD", lat: 39.4143, lon: -77.4105 };
const NEEDS = { items: [2, 2, 1, 1].map((h, i) => ({ need_id: `n${i}`, title: `Job ${i}`, est_hours_saved_week: h })) };

function cardHarness(bundle: unknown, photo: Response | (() => Response) = () => new Response(JPEG)) {
  const cards: { url: string; layout: Record<string, unknown> }[] = [];
  const h = harness(
    (c) => {
      if (c.url === "http://api.test/api/owners/o_abc123") return bundle === null ? new Response("no", { status: 500 }) : json(200, bundle);
      if (c.url.startsWith("https://web.test/api/street")) return typeof photo === "function" ? photo() : photo;
      return json(200, { replies: ["Your plan is ready."], links: [PAGE] });
    },
    {
      sendLink: async (u) => void h.events.push(`card:${u}`),
      sendCard: async (url, layout) => {
        cards.push({ url, layout: layout as Record<string, unknown> });
        h.events.push(`app:${url}`);
      },
    },
  );
  return { ...h, cards };
}

test("the page link goes out as an app card with the street photo and the plan's numbers", async () => {
  const h = cardHarness({ profile: PROFILE, needs: NEEDS });
  assert.equal(await handleMessage(msg(), h.deps), "replied");
  assert.deepEqual(h.events.filter((e) => !e.startsWith("sleep")), ["send:Your plan is ready.", `app:${PAGE}`]);
  assert.ok(h.calls.some((c) => c.url === "https://web.test/api/street?lat=39.41430&lon=-77.41050"));
  const { image, ...rest } = h.cards[0]!.layout;
  assert.deepEqual(image, JPEG);
  assert.deepEqual(rest, {
    imageTitle: "Bean & Brick Coffee",
    imageSubtitle: "Coffee shop · Frederick, MD",
    caption: "Your AI plan",
    subcaption: "4 jobs AI can take",
    trailingCaption: "6 hrs",
    trailingSubcaption: "back a week",
    summary: "Bean & Brick Coffee: your AI plan",
  });
});

test("no street photo: the card keeps the name and numbers without an image", async () => {
  const h = cardHarness({ profile: { ...PROFILE, lat: null, lon: null }, needs: { items: NEEDS.items.slice(0, 1) } }, () => new Response("none", { status: 404 }));
  await handleMessage(msg(), h.deps);
  assert.ok(h.calls.some((c) => c.url === "https://web.test/api/street?q=Frederick%2C+MD"));
  assert.deepEqual(h.cards[0]!.layout, {
    caption: "Bean & Brick Coffee",
    subcaption: "Your AI plan · 1 job AI can take",
    trailingCaption: "2 hrs",
    trailingSubcaption: "back a week",
    summary: "Bean & Brick Coffee: your AI plan",
  });
});

test("a photo that is not a JPEG is left off the card", async () => {
  const h = cardHarness({ profile: PROFILE, needs: NEEDS }, () => new Response("<html>"));
  await handleMessage(msg(), h.deps);
  assert.equal(h.cards[0]!.layout.image, undefined);
  assert.equal(h.cards[0]!.layout.caption, "Bean & Brick Coffee");
});

test("before there is a plan, or if the page can't be read, the page goes out as a link card", async () => {
  for (const bundle of [{ profile: null, needs: null }, { profile: PROFILE, needs: null }, null]) {
    const h = cardHarness(bundle);
    await handleMessage(msg(), h.deps);
    assert.deepEqual(h.cards, []);
    assert.ok(h.events.includes(`card:${PAGE}`));
  }
});

// Native polls: the API offers a pending approval as a yes/no poll; a vote goes back to /api/imessage/vote.
const QUESTION = "Set up Chatling for you?";
const OPTIONS = ["Yes, set it up", "Not now"];
const pollDeps = (h: { events: string[] }) => ({
  sendPoll: async (q: string, opts: string[]) => void h.events.push(`poll:${q}|${opts.join("|")}`),
});
const vote = (option: string, selected = true): IncomingLike => ({
  direction: "inbound",
  sender: { id: PHONE },
  content: { type: "poll_option", option: { title: option }, poll: { type: "poll", title: QUESTION, options: OPTIONS.map((title) => ({ title })) }, selected } as any,
});

test("a poll from the API goes out last, after the replies and the page card", async () => {
  const h: any = harness(() => json(200, { replies: ["I asked to set up Chatling."], links: ["https://web.test/b/o_abc"], poll: { question: QUESTION, options: OPTIONS } }));
  Object.assign(h.deps, pollDeps(h), { sendLink: async (u: string) => void h.events.push(`card:${u}`) });
  assert.equal(await handleMessage(msg(), h.deps), "replied");
  assert.deepEqual(h.events.filter((e: string) => !e.startsWith("sleep")), [
    "send:I asked to set up Chatling.",
    "card:https://web.test/b/o_abc",
    `poll:${QUESTION}|Yes, set it up|Not now`,
  ]);
});

test("a malformed poll is dropped and the rest still goes out", async () => {
  for (const poll of [{ question: "", options: OPTIONS }, { question: QUESTION, options: ["only one"] }, "yes?"]) {
    const h: any = harness(() => json(200, { replies: ["ok"], links: [], poll }));
    Object.assign(h.deps, pollDeps(h));
    assert.equal(await handleMessage(msg(), h.deps), "replied");
    assert.deepEqual(h.events, ["send:ok"]);
  }
});

test("a vote posts {from_hash, poll, option} to the vote route and texts back the replies", async () => {
  const h: any = harness(() => json(200, { replies: ["Setting up Chatling now."], links: [] }));
  Object.assign(h.deps, pollDeps(h));
  assert.equal(await handleMessage(vote("Yes, set it up"), h.deps), "replied");
  assert.equal(h.calls[0].url, "http://api.test/api/imessage/vote");
  assert.equal((h.calls[0].init.headers as Record<string, string>)["x-relay-secret"], "s3cret");
  assert.deepEqual(JSON.parse(h.calls[0].init.body), { from_hash: hashSender(PHONE), poll: QUESTION, option: "Yes, set it up" });
  assert.deepEqual(h.events, ["send:Setting up Chatling now."]);
  assert.ok(h.logs.some((l: string) => l.startsWith("[vote] ")) && !h.logs.some((l: string) => l.includes(PHONE) || l.includes("Chatling")));
});

test("taking a vote back, or a vote from us, is ignored", async () => {
  for (const m of [vote("Not now", false), { ...vote("Yes, set it up"), direction: "outbound" }]) {
    const h = harness(() => json(200, { replies: ["x"] }));
    assert.equal(await handleMessage(m, h.deps), "ignored");
    assert.equal(h.calls.length, 0);
  }
});
