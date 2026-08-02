import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
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
      } else if (entry.isSymbolicLink()) throw new Error(`unsupported symbolic link: ${relative(root, path)}`);
      else throw new Error(`unsupported entry type: ${relative(root, path)}`);
    }
  };
  visit(root);
  return files.sort();
}

function symlinkTrees(targets: readonly [string, string]) {
  const parent = mkdtempSync(join(tmpdir(), "qm-sandbox-parity-"));
  const roots = [join(parent, "left"), join(parent, "right")] as const;
  mkdirSync(roots[0]);
  mkdirSync(roots[1]);
  symlinkSync(targets[0], join(roots[0], "linked-entry"));
  symlinkSync(targets[1], join(roots[1], "linked-entry"));
  return { parent, roots };
}

test("hosted sandbox exactly matches the approved synthetic sandbox", () => {
  assert.deepEqual(
    tree("deploy/layers/alpha-ticker-stage-a-hosted/sandbox"),
    tree("deploy/layers/alpha-ticker-stage-a/sandbox"),
  );
});

test("matching symlinks cannot silently pass parity inventory", (context) => {
  const { parent, roots } = symlinkTrees(["same-target", "same-target"]);
  context.after(() => rmSync(parent, { force: true, recursive: true }));

  for (const root of roots) {
    assert.throws(() => tree(root), /unsupported symbolic link: linked-entry/);
  }
});

test("mismatched symlinks cannot silently pass parity inventory", (context) => {
  const { parent, roots } = symlinkTrees(["first-target", "second-target"]);
  context.after(() => rmSync(parent, { force: true, recursive: true }));

  for (const root of roots) {
    assert.throws(() => tree(root), /unsupported symbolic link: linked-entry/);
  }
});
