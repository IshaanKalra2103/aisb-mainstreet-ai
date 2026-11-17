// Demo of MainStreet AI's native iMessage UI, sent from the project's Photon line to one phone:
// a plan card with a photo of the shop, a job card, a yes/no poll and a "done" text with confetti.
// Uses the example business Bean & Brick Coffee (web/data/demo/coffee.json). Send-only: the relay owns the inbound stream,
// so a vote on the poll here is not acted on.
//
//   node --env-file=.env demo_rich.mjs --to +15551234567 [--web https://mainstreet-ai-five.vercel.app]
//
// Prints one JSON line and never the number.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { Spectrum, app as appCard, poll, text } from "spectrum-ts";
import { effect, imessage } from "@spectrum-ts/imessage";

const { values } = parseArgs({
  options: {
    to: { type: "string" },
    web: { type: "string", default: "https://mainstreet-ai-five.vercel.app" },
    "skip-intro": { type: "boolean", default: false },
  },
});
if (!values.to || !/^\+\d{8,15}$/.test(values.to)) {
  console.log(JSON.stringify({ ok: false, error: "--to must be an E.164 number" }));
  process.exit(2);
}
const photo = (name) => new Uint8Array(readFileSync(new URL(`../web/public/${name}`, import.meta.url)));
const page = `${values.web}/b/demo-coffee`;

/** iMessage app card (the balloon Apple's own Polls use), opened through Photon's Spectrum iMessage app. */
const card = (url, layout) => appCard(url, { layout: { summary: layout.caption, ...layout } });

const app = await Spectrum({
  projectId: process.env.PROJECT_ID,
  projectSecret: process.env.PROJECT_SECRET,
  providers: [imessage.config()],
  options: { logLevel: "warn" },
});
const sent = [];
const pause = () => new Promise((r) => setTimeout(r, 2500));
try {
  const im = imessage(app);
  const dm = await im.space.create(await im.user(values.to));

  if (!values["skip-intro"]) {
    await dm.send(text("Here's what AI can take off your plate at Bean & Brick."));
    sent.push("text");
    await pause();
  }
  await dm.send(
    card(page, {
      image: photo("shops/coffee.jpg"),
      imageTitle: "Bean & Brick Coffee",
      imageSubtitle: "Coffee shop · Frederick, MD",
      caption: "Your AI plan",
      subcaption: "4 jobs AI can take",
      trailingCaption: "6 hrs",
      trailingSubcaption: "back a week",
    }),
  );
  sent.push("plan-card");
  await pause();
  await dm.send(
    card(page, {
      image: photo("jobs/coffee/website-chat.jpg"),
      imageTitle: "Website chat and FAQ",
      imageSubtitle: "Job 1 of 4",
      caption: "Our pick: Chatling",
      subcaption: "Free plan · about 30 min to set up",
      trailingCaption: "2 hrs",
      trailingSubcaption: "a week",
    }),
  );
  sent.push("job-card");
  await pause();
  await dm.send(poll("Set up Chatling on your website?", "Yes, set it up", "Not now"));
  sent.push("poll");
  await pause();
  await dm.send(effect(text("Done. Chatling is answering questions on your site."), "com.apple.messages.effect.CKConfettiEffect"));
  sent.push("confetti-text");
  console.log(JSON.stringify({ ok: true, sent }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, sent, error: (e instanceof Error ? e.message : String(e)).replace(/\+\d{6,}/g, "+…") }));
  process.exitCode = 1;
} finally {
  await app.stop();
}
