import { test } from "node:test";
import assert from "node:assert/strict";
import { chatBackground } from "../src/background.ts";

const IMG = new Uint8Array([0xff, 0xd8, 0xff]);

function fakeLine(has: boolean, fail = false) {
  const calls: string[] = [];
  const client: any = {
    chats: {
      hasBackground: async (chat: string) => { calls.push(`has:${chat}`); if (fail) throw new Error("down"); return has; },
      setBackground: async (chat: string, data: Uint8Array) => { calls.push(`set:${chat}:${data.length}`); },
    },
  };
  return { calls, line: async () => client };
}

test("a thread with no background gets ours, once per run", async () => {
  const f = fakeLine(false);
  const apply = chatBackground(f.line, IMG);
  assert.equal(await apply("any;-;+1"), "set");
  assert.equal(await apply("any;-;+1"), "skipped");
  assert.deepEqual(f.calls, ["has:any;-;+1", "set:any;-;+1:3"]);
});

test("a thread that already has a background keeps it", async () => {
  const f = fakeLine(true);
  assert.equal(await chatBackground(f.line, IMG)("any;-;+2"), "kept");
  assert.deepEqual(f.calls, ["has:any;-;+2"]);
});

test("a failing line never throws and is not asked again for that thread", async () => {
  const f = fakeLine(false, true);
  const apply = chatBackground(f.line, IMG);
  assert.equal(await apply("any;-;+3"), "failed");
  assert.equal(await apply("any;-;+3"), "skipped");
  assert.deepEqual(f.calls, ["has:any;-;+3"]);
});
