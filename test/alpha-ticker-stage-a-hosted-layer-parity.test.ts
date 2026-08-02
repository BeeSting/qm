import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

function tree(root: string): string[] {
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) {
        const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
        files.push(`${relative(root, path)}:${statSync(path).mode & 0o777}:${digest}`);
      }
    }
  };
  visit(root);
  return files.sort();
}

test("hosted sandbox exactly matches the approved synthetic sandbox", () => {
  assert.deepEqual(
    tree("deploy/layers/alpha-ticker-stage-a-hosted/sandbox"),
    tree("deploy/layers/alpha-ticker-stage-a/sandbox"),
  );
});
