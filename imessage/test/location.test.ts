// The location kit's memory of owners who were asked and did not share in time: only they are checked later, a spot
// found is handed over once, and the memory lapses after a day. No Photon: the line client is a fake.
import assert from "node:assert/strict";
import { test } from "node:test";
import { LATE_MS, locationKit } from "../src/location.ts";

const WHO = "+14105550123";
const SPOT = { latitude: 39.4143, longitude: -77.4105, accuracy: 4 };

function fakeLine() {
  const gets: string[] = [];
  const answers: Array<typeof SPOT | Error> = [];
  let clock = 1_000_000;
  const client = {
    locations: {
      request: async () => ({ status: "sent", address: WHO, messageGuid: "g" }),
      get: async (who: string) => {
        gets.push(who);
        const a = answers.shift() ?? new Error("not sharing");
        if (a instanceof Error) throw a;
        return a;
      },
    },
  };
  const kit = locationKit("p", "s", { client: async () => client as never, now: () => clock });
  const sleep = async (ms: number) => void (clock += ms);
  return { kit, gets, answers, sleep, advance: (ms: number) => void (clock += ms) };
}

/** Ask the owner, then let the whole wait run out with no share. */
async function askedAndWaitedOut(f: ReturnType<typeof fakeLine>) {
  assert.equal(await f.kit.request("chat", WHO), "sent");
  assert.equal(await f.kit.wait(WHO, f.sleep), null);
  f.gets.length = 0;
}

test("an owner who was never asked is not checked", async () => {
  const f = fakeLine();
  f.answers.push(SPOT);
  assert.equal(await f.kit.late(WHO), null);
  assert.deepEqual(f.gets, []);
});

test("an owner still inside the wait is left to the wait", async () => {
  const f = fakeLine();
  await f.kit.request("chat", WHO);
  f.answers.push(SPOT);
  assert.equal(await f.kit.late(WHO), null);
  assert.deepEqual(f.gets, []);
});

test("an owner whose wait ran out is checked on their next text, and a spot found is handed over once", async () => {
  const f = fakeLine();
  await askedAndWaitedOut(f);
  f.answers.push(SPOT);
  assert.deepEqual(await f.kit.late(WHO), { lat: 39.4143, lon: -77.4105, acc: 4 });
  assert.deepEqual(f.gets, [WHO]);
  assert.equal(await f.kit.late(WHO), null);
  assert.deepEqual(f.gets, [WHO], "no second check once the spot was handed over");
});

test("a check that finds nothing keeps the owner on the list for their next text", async () => {
  const f = fakeLine();
  await askedAndWaitedOut(f);
  assert.equal(await f.kit.late(WHO), null);
  f.answers.push(SPOT);
  assert.deepEqual(await f.kit.late(WHO), { lat: 39.4143, lon: -77.4105, acc: 4 });
});

test("the list lapses a day after the request", async () => {
  const f = fakeLine();
  await askedAndWaitedOut(f);
  f.advance(LATE_MS);
  f.answers.push(SPOT);
  assert.equal(await f.kit.late(WHO), null);
  assert.deepEqual(f.gets, []);
});
