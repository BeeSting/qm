import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("Stage A records the reviewed QM source pin", () => {
  const lock = JSON.parse(readFileSync("UPSTREAM.lock.json", "utf8"));

  assert.equal(lock.repository, "https://github.com/yc-software/qm.git");
  assert.equal(lock.commit, "7f2c916360f1797a8ff2a77ce2ce40c5fabab087");
  assert.equal(lock.package, "@yc-software/qm@0.1.4");
  assert.equal(lock.node, "24.18.1");
  assert.equal(lock.npm, "11.16.0");
  assert.equal(process.version, "v24.18.1");
});
