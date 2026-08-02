# Alpha Ticker QM Hosted Stage A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy and evaluate a five-business-day, model-backed QM pilot for three Alpha Ticker team members using synthetic fixtures only, with enforced isolation, egress, spend, revocation, evidence, and teardown controls.

**Architecture:** Preserve the completed local Stage A package and create a separate Fly deployment in `deploy/layers/alpha-ticker-stage-a-hosted`. QM uses its official Fly target, Managed Postgres, Tigris, Sprite sandboxes, a dedicated default-deny egress proxy, OpenAI through the `pi` harness, and the existing synthetic Alpha Packet tool and workflow bundle. Vercel, Railway, Supabase, and the production Ticker Alpha repository remain outside the deployment.

**Tech Stack:** Node.js 24.18.1, npm 11.16.0, TypeScript, Node test runner, QM 0.1.4 pinned to source commit `7f2c916360f1797a8ff2a77ce2ce40c5fabab087`, Fly.io, Managed Postgres, Tigris, Fly Sprites, Envoy, OpenAI API, SMTP.

---

## Fixed Decisions

- Hosted org id and app prefix: `alpha-ticker-stage-a-hosted`.
- Fly organization: `personal`. If preflight shows that this is not the sponsor-controlled billing organization, stop and amend the approved design before mutation.
- Fly region: `jnb`.
- Public origin: `https://alpha-ticker-stage-a-hosted-portal.fly.dev`.
- Egress proxy: `https://alpha-ticker-stage-a-egress.fly.dev`.
- Provider and model: OpenAI, `gpt-5.6-terra`.
- Harness and posture: `pi`, `strict`.
- Budget window: seven days (`604800000` ms).
- Per-principal QM brake: US$20.
- Organization QM brake: US$45.
- Provider maximum authorized exposure: US$50 with auto-recharge disabled.
- Participants: three sponsor-approved work-email identities represented in evidence as `P1`, `P2`, and `P3`.
- Services: `core`, `web-ui`, `admin`, `portal`, and `auth` only.
- Core external dependencies: the dedicated OpenAI project, SMTP relay, Fly control plane, Managed Postgres, and Tigris only. The Sprite proxy does not constitute a core egress firewall, and this limitation must remain explicit.
- Pilot duration: five consecutive business days, never beyond the seven-day budget window.

## Mutation Rule

Tasks 1 through 9 are repository-only and perform no cloud or provider mutation. Task 10 may create the dedicated provider project and bounded SMTP grant, but it creates no Fly resource, uploads no deployment secret, and makes no billable model call. Tasks 11 onward require a passing H0 activation record and are the first tasks allowed to mutate Fly or use the model provider.

### Task 1: Establish the exact execution environment

**Files:**
- Verify: `UPSTREAM.lock.json`
- Verify: `package.json`
- Verify: `test/alpha-ticker-stage-a-pin.test.ts`

- [ ] **Step 1: Create an isolated execution worktree**

Use the `using-git-worktrees` skill. After this plan is committed, create branch `codex/qm-hosted-stage-a-implementation` from the clean HEAD of `codex/qm-stage-a-synthetic-pilot`. Record that base commit before editing. Do not execute from the production Ticker Alpha worktree.

- [ ] **Step 2: Put the approved runtime first on PATH**

```bash
brew install volta
export VOLTA_HOME="$HOME/.volta"
export PATH="$VOLTA_HOME/bin:$PATH"
volta install node@24.18.1 npm@11.16.0
node --version
npm --version
```

Expected:

```text
v24.18.1
11.16.0
```

Do not weaken `test/alpha-ticker-stage-a-pin.test.ts` to match another runtime.

- [ ] **Step 3: Verify the baseline and clean worktree**

```bash
git status --short
git merge-base --is-ancestor 7f2c916360f1797a8ff2a77ce2ce40c5fabab087 HEAD
npm ci
node --test test/alpha-ticker-stage-a-pin.test.ts
```

Expected: clean status before implementation, ancestor check exit 0, dependency install succeeds, and the pin test passes.

### Task 2: Define the hosted deployment policy test-first

**Files:**
- Create: `test/alpha-ticker-stage-a-hosted-policy.test.ts`
- Create: `deploy/layers/alpha-ticker-stage-a-hosted/qm.config.jsonc`
- Create: `deploy/layers/alpha-ticker-stage-a-hosted/stage-a-hosted-policy.json`
- Create: `deploy/layers/alpha-ticker-stage-a-hosted/.env.example`
- Create: `deploy/layers/alpha-ticker-stage-a-hosted/.gitignore`
- Create: `deploy/layers/alpha-ticker-stage-a-hosted/package.json`
- Create: `deploy/layers/alpha-ticker-stage-a-hosted/package-lock.json`

- [ ] **Step 1: Write the failing hosted-policy test**

Create `test/alpha-ticker-stage-a-hosted-policy.test.ts` with these assertions:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { loadConfigAt } from "../cli/src/config.ts";
import { egressDecision } from "../src/resolution/egress-policy.ts";

const root = "deploy/layers/alpha-ticker-stage-a-hosted";

test("hosted Stage A is model-backed, bounded, and connector-free", () => {
  const config = loadConfigAt(`${root}/qm.config.jsonc`).config;
  const policy = JSON.parse(readFileSync(`${root}/stage-a-hosted-policy.json`, "utf8"));

  assert.equal(config.orgId, "alpha-ticker-stage-a-hosted");
  assert.equal(config.target, "fly");
  assert.equal(config.publicUrl, "https://alpha-ticker-stage-a-hosted-portal.fly.dev");
  assert.equal(config.appPrefix, "alpha-ticker-stage-a-hosted");
  assert.equal(config.region, "jnb");
  assert.equal(config.flyOrg, "personal");
  assert.equal(config.modelProvider, "openai");
  assert.equal(config.model, "gpt-5.6-terra");
  assert.deepEqual(config.services, ["core", "web-ui", "admin", "portal", "auth"]);
  assert.deepEqual(config.plugins, []);
  assert.equal(config.env.core?.HARNESS, "pi");
  assert.equal(config.env.core?.HARNESS_SECURITY_POSTURE, "strict");
  assert.equal(config.env.core?.BUDGET_WINDOW_MS, "604800000");
  assert.equal(config.env.core?.BUDGET_USD_PER_WINDOW, "20");
  assert.equal(config.env.core?.ORG_BUDGET_USD_PER_WINDOW, "45");
  assert.equal(
    config.env.core?.SPRITES_EGRESS_PROXY_URL,
    "https://alpha-ticker-stage-a-egress.fly.dev",
  );

  assert.equal(policy.dataClass, "public-synthetic-only");
  assert.equal(policy.modelBacked, true);
  assert.equal(policy.liveAlphaPackets, false);
  assert.equal(policy.productionCredentials, false);
  assert.deepEqual(policy.allowedTools, ["alpha-packet"]);
  assert.deepEqual(policy.allowedSandboxControlPlaneHosts, [
    "alpha-ticker-stage-a-hosted-portal.fly.dev",
  ]);
  assert.deepEqual(policy.allowedSandboxExternalHosts, []);
  assert.deepEqual(policy.coreExternalDependencies, [
    "openai-api",
    "smtp-relay",
    "fly-control-plane",
    "fly-managed-postgres",
    "tigris-object-storage",
  ]);
  assert.ok(policy.prohibitedCapabilities.includes("browser"));
  assert.ok(policy.prohibitedCapabilities.includes("connectors"));
  assert.ok(policy.prohibitedCapabilities.includes("external-actions"));
});

test("hosted Stage A deliberately keeps pinned QM in allowlist mode", () => {
  const policy = JSON.parse(readFileSync(`${root}/stage-a-hosted-policy.json`, "utf8"));
  const allowedHosts = policy.allowedSandboxControlPlaneHosts;

  assert.deepEqual(allowedHosts, ["alpha-ticker-stage-a-hosted-portal.fly.dev"]);
  assert.equal(
    egressDecision("alpha-ticker-stage-a-hosted-portal.fly.dev", { allowedHosts, deniedHosts: [] }).allow,
    true,
  );
  assert.equal(egressDecision("example.com", { allowedHosts, deniedHosts: [] }).allow, false);

  // Characterize the pinned upstream behavior that makes an empty list unsafe.
  assert.equal(egressDecision("example.com", { allowedHosts: [], deniedHosts: [] }).allow, true);
});
```

- [ ] **Step 2: Run the test and verify the expected failure**

```bash
node --test test/alpha-ticker-stage-a-hosted-policy.test.ts
```

Expected: FAIL because the hosted deployment directory does not exist.

- [ ] **Step 3: Scaffold the separate Fly deployment**

```bash
cd deploy/layers/alpha-ticker-stage-a
npm exec qm -- init ../alpha-ticker-stage-a-hosted \
  --org alpha-ticker-stage-a-hosted \
  --target fly \
  --model-provider openai \
  --email-transport smtp
cd ../../..
```

Confirm that `deploy/layers/alpha-ticker-stage-a-hosted/.env` is mode `0600`, ignored, and absent from `git status`. Never open or print that file.

- [ ] **Step 4: Replace the scaffolded config with the approved config**

Use `apply_patch` to make `qm.config.jsonc` contain these effective values, retaining only comments that describe a configured field:

```jsonc
{
  "contract": 1,
  "orgId": "alpha-ticker-stage-a-hosted",
  "publicUrl": "https://alpha-ticker-stage-a-hosted-portal.fly.dev",
  "target": "fly",
  "modelProvider": "openai",
  "model": "gpt-5.6-terra",
  "appPrefix": "alpha-ticker-stage-a-hosted",
  "region": "jnb",
  "flyOrg": "personal",
  "services": ["core", "web-ui", "admin", "portal", "auth"],
  "plugins": [],
  "skills": [],
  "env": {
    "core": {
      "HARNESS": "pi",
      "HARNESS_SECURITY_POSTURE": "strict",
      "SNAPSHOT_STORE": "s3",
      "TRANSFER_STORE": "s3",
      "S3_BUCKET": "alpha-ticker-stage-a-hosted-data",
      "S3_REGION": "auto",
      "BUDGET_WINDOW_MS": "604800000",
      "BUDGET_USD_PER_WINDOW": "20",
      "ORG_BUDGET_USD_PER_WINDOW": "45",
      "SPRITES_EGRESS_PROXY_URL": "https://alpha-ticker-stage-a-egress.fly.dev"
    },
    "auth": {
      "AUTH_EMAIL_TRANSPORT": "smtp",
      "AUTH_BRAND_NAME": "Alpha Ticker QM Stage A"
    }
  },
  "secretEnv": { "core": { "ADMIN_GRANTS": "ADMIN_GRANTS" } },
  "sandbox": { "app": "alpha-ticker-stage-a-hosted-sandboxes" }
}
```

- [ ] **Step 5: Add the machine-readable hosted policy**

Create `stage-a-hosted-policy.json`:

```json
{
  "stage": "A-hosted",
  "dataClass": "public-synthetic-only",
  "cloudMutation": "gated",
  "modelBacked": true,
  "liveAlphaPackets": false,
  "productionCredentials": false,
  "allowedTools": ["alpha-packet"],
  "allowedSandboxControlPlaneHosts": ["alpha-ticker-stage-a-hosted-portal.fly.dev"],
  "allowedSandboxExternalHosts": [],
  "coreExternalDependencies": [
    "openai-api",
    "smtp-relay",
    "fly-control-plane",
    "fly-managed-postgres",
    "tigris-object-storage"
  ],
  "allowedTickers": ["SYNTH"],
  "allowedPortfolios": ["SYNTHETIC_NUCLEUS"],
  "prohibitedCapabilities": [
    "browser",
    "connectors",
    "published-apps",
    "public-links",
    "slack",
    "telegram",
    "github",
    "database-access",
    "brokerage",
    "external-actions"
  ]
}
```

- [ ] **Step 6: Curate the secret-name catalog**

Replace the broad generated `.env.example` with names required by this deployment only. Keep every value empty:

```dotenv
ADMIN_GRANTS=
AUTH_ALLOWED_EMAILS=
AUTH_CLIENT_SECRET=
AUTH_EMAIL_FROM=
AUTH_SIGNING_JWK=
AUTH_TOKEN_SECRET=
CAPABILITY_SECRET=
CONNECTOR_SECRET_KEY=
CORE_SIGNING_SECRET=
FLY_SANDBOX_API_TOKEN=
OPENAI_API_KEY=
PORTAL_IDENTITY_SECRET=
PORTAL_SESSION_SECRET=
PUBLIC_API_URL=
SKILL_SIGNING_SECRET=
SMTP_HOST=
SMTP_PASSWORD=
SMTP_USERNAME=
```

The `.gitignore` must contain exactly:

```gitignore
.env
node_modules/
.generated/
```

- [ ] **Step 7: Pin the deployment package and install reproducibly**

Set `package.json` dependency `@yc-software/qm` to exact version `0.1.4`, retain Node `>=24.0.0`, then run:

```bash
cd deploy/layers/alpha-ticker-stage-a-hosted
npm install
cd ../../..
```

- [ ] **Step 8: Run the policy test**

```bash
node --test test/alpha-ticker-stage-a-hosted-policy.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit the deployment contract**

```bash
git add test/alpha-ticker-stage-a-hosted-policy.test.ts \
  deploy/layers/alpha-ticker-stage-a-hosted
git commit -m "test: define hosted Stage A deployment boundary"
```

Before committing, verify `.env` and `node_modules` are not staged.

### Task 3: Add the default-deny egress proxy contract

**Files:**
- Create: `deploy/layers/alpha-ticker-stage-a-hosted/egress-proxy.fly.toml`
- Create: `scripts/alpha-ticker-stage-a-hosted/probe-egress.mjs`
- Create: `test/alpha-ticker-stage-a-hosted-egress.test.ts`

- [ ] **Step 1: Write the failing proxy-contract test**

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const proxyConfig = "deploy/layers/alpha-ticker-stage-a-hosted/egress-proxy.fly.toml";

test("hosted Stage A egress proxy is public, token-gated, and fixed to jnb", () => {
  const body = readFileSync(proxyConfig, "utf8");
  assert.match(body, /^app = "alpha-ticker-stage-a-egress"$/m);
  assert.match(body, /^primary_region = "jnb"$/m);
  assert.match(body, /^\s*EGRESS_TOKENLESS = "deny"$/m);
  assert.match(body, /^\s*internal_port = 48080$/m);
  assert.match(body, /^\s*port = 443$/m);
  assert.match(body, /^\s*handlers = \["tls"\]$/m);
  assert.match(body, /^\s*min_machines_running = 1$/m);
  assert.doesNotMatch(body, /EGRESS_TOKENLESS = "open"/);
});

test("the hosted egress probe never prints or accepts a token on argv", () => {
  const body = readFileSync("scripts/alpha-ticker-stage-a-hosted/probe-egress.mjs", "utf8");
  assert.match(body, /CAPABILITY_SECRET/);
  assert.match(body, /signed-unapproved-host-deny: pass/);
  assert.doesNotMatch(body, /--token|console\.log\([^)]*token|process\.stdout\.write\([^)]*token/);
});
```

- [ ] **Step 2: Run the test and verify the expected failure**

```bash
node --test test/alpha-ticker-stage-a-hosted-egress.test.ts
```

Expected: FAIL because the proxy config does not exist.

- [ ] **Step 3: Add the Fly proxy config**

```toml
app = "alpha-ticker-stage-a-egress"
primary_region = "jnb"

[env]
  EGRESS_TOKENLESS = "deny"

[[services]]
  internal_port = 48080
  protocol = "tcp"
  auto_stop_machines = false
  min_machines_running = 1

  [[services.ports]]
    port = 443
    handlers = ["tls"]

  [[services.tcp_checks]]
    interval = "15s"
    timeout = "2s"
    grace_period = "10s"

[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"

kill_signal = "SIGTERM"
kill_timeout = "10s"
```

- [ ] **Step 4: Prove the contract and existing proxy implementation**

Implement `probe-egress.mjs` as a content-minimized live probe. It must read `CAPABILITY_SECRET` directly from a mode-`0600` env file and issue three bounded HTTPS `CONNECT` checks to the supplied proxy and host. First, mint a short-lived `EGRESS_PROXY_AUD` capability whose `allowedHosts` contains exactly the supplied canary host, require `CONNECT 200`, and immediately destroy the tunnel without application data. Then require an unsigned CONNECT and a CONNECT signed by a separate short-lived capability with `egress: { allowedHosts: ["alpha-ticker-stage-a-hosted-portal.fly.dev"], deniedHosts: [] }` to be denied. Neither the secret nor either token may appear on argv, in process output, or in evidence. The successful canary check stays silent; the probe prints only:

```text
unsigned-deny: pass
signed-unapproved-host-deny: pass
```

Unit-test all three CONNECT paths, successful-tunnel teardown, bounded timeout cleanup, and hardened env-file rejection against local test servers before using the probe on Fly. Only the two denial pass lines may be public output.

```bash
node --test test/alpha-ticker-stage-a-hosted-egress.test.ts test/egress-proxy-config.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add deploy/layers/alpha-ticker-stage-a-hosted/egress-proxy.fly.toml \
  scripts/alpha-ticker-stage-a-hosted/probe-egress.mjs \
  test/alpha-ticker-stage-a-hosted-egress.test.ts
git commit -m "security: define hosted Stage A egress proxy"
```

### Task 4: Reuse the approved synthetic workflow layer without drift

**Files:**
- Create: `deploy/layers/alpha-ticker-stage-a-hosted/sandbox/skills/**`
- Create: `deploy/layers/alpha-ticker-stage-a-hosted/sandbox/tools/alpha-packet/**`
- Create: `test/alpha-ticker-stage-a-hosted-layer-parity.test.ts`

- [ ] **Step 1: Write the failing parity test**

Create a test that hashes relative path, mode, and bytes for every file under both sandbox roots and requires exact equality:

```ts
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
```

- [ ] **Step 2: Run the test and verify the expected failure**

```bash
node --test test/alpha-ticker-stage-a-hosted-layer-parity.test.ts
```

Expected: FAIL because the scaffolded sandbox differs from the approved layer.

- [ ] **Step 3: Mechanically replace the sandbox**

Use a mechanical directory copy, preserving the executable bit on `alpha-packet`:

```bash
rsync -a --delete \
  deploy/layers/alpha-ticker-stage-a/sandbox/ \
  deploy/layers/alpha-ticker-stage-a-hosted/sandbox/
```

- [ ] **Step 4: Run parity and existing contract tests against both layers**

First run parity:

```bash
node --test test/alpha-ticker-stage-a-hosted-layer-parity.test.ts
```

Then update `test/alpha-ticker-stage-a-workflows.test.ts` and `test/alpha-ticker-stage-a-packet-tool.test.ts` to loop over these roots without changing their assertions:

```ts
const deploymentRoots = [
  "deploy/layers/alpha-ticker-stage-a",
  "deploy/layers/alpha-ticker-stage-a-hosted",
] as const;
```

Run:

```bash
node --test \
  test/alpha-ticker-stage-a-hosted-layer-parity.test.ts \
  test/alpha-ticker-stage-a-workflows.test.ts \
  test/alpha-ticker-stage-a-packet-tool.test.ts
```

Expected: PASS for both deployment roots.

- [ ] **Step 5: Commit**

```bash
git add deploy/layers/alpha-ticker-stage-a-hosted/sandbox \
  test/alpha-ticker-stage-a-hosted-layer-parity.test.ts \
  test/alpha-ticker-stage-a-workflows.test.ts \
  test/alpha-ticker-stage-a-packet-tool.test.ts
git commit -m "feat: reuse synthetic workflows in hosted Stage A"
```

### Task 5: Generalize the boundary scanner for an approved hosted origin

**Files:**
- Modify: `scripts/alpha-ticker-stage-a/check-boundary.mjs`
- Create: `scripts/alpha-ticker-stage-a-hosted/check-boundary.mjs`
- Modify: `test/alpha-ticker-stage-a-boundary.test.ts`
- Create: `test/alpha-ticker-stage-a-hosted-boundary.test.ts`

- [ ] **Step 1: Write failing hosted-origin tests**

The hosted test must require the exact Fly portal URL and reject any other URL:

```ts
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { scanDirectory } from "../scripts/alpha-ticker-stage-a/check-boundary.mjs";

const allowed = new Set(["https://alpha-ticker-stage-a-hosted-portal.fly.dev"]);

test("committed hosted layer is boundary-clean under its exact origin", () => {
  assert.deepEqual(
    scanDirectory("deploy/layers/alpha-ticker-stage-a-hosted", { allowedPublicUrls: allowed }),
    [],
  );
});

test("hosted profile rejects an unapproved public origin", () => {
  const root = mkdtempSync(join(tmpdir(), "hosted-boundary-"));
  try {
    writeFileSync(join(root, "qm.config.jsonc"), '{"publicUrl":"https://other.fly.dev"}\n');
    assert.ok(
      scanDirectory(root, { allowedPublicUrls: allowed }).some(
        (violation) => violation.ruleId === "UNAPPROVED_PUBLIC_URL",
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run both boundary suites and verify hosted failure**

```bash
node --test test/alpha-ticker-stage-a-boundary.test.ts test/alpha-ticker-stage-a-hosted-boundary.test.ts
```

Expected: local tests pass and hosted tests fail because scanner options are not implemented.

- [ ] **Step 3: Add an explicit URL policy to the scanner**

Change the exported signature to:

```js
export function scanDirectory(
  root,
  { allowedPublicUrls = new Set(["http://localhost:8082"]) } = {},
) {
```

Change `scanPublicUrl` to parse and normalize the configured URL and add `UNAPPROVED_PUBLIC_URL` unless its origin appears in `allowedPublicUrls`. Keep the existing local default and all content, secret, tool, and staged-diff rules. Add the same option to `scanStagedDeploymentDiff` so staged hosted changes are checked against the hosted origin rather than the local default.

- [ ] **Step 4: Add the hosted CLI wrapper**

Create `scripts/alpha-ticker-stage-a-hosted/check-boundary.mjs`:

```js
#!/usr/bin/env node

import { scanDirectory, scanStagedDeploymentDiff } from "../alpha-ticker-stage-a/check-boundary.mjs";

const root = "deploy/layers/alpha-ticker-stage-a-hosted";
const options = {
  allowedPublicUrls: new Set(["https://alpha-ticker-stage-a-hosted-portal.fly.dev"]),
};
const violations = [...scanDirectory(root, options), ...scanStagedDeploymentDiff(process.cwd(), root, options)];
if (!violations.length) {
  process.stdout.write("hosted-boundary-check: pass\n");
} else {
  for (const violation of violations) process.stderr.write(`${violation.file}:${violation.ruleId}\n`);
  process.exitCode = 1;
}
```

- [ ] **Step 5: Run the scanner tests and both CLIs**

```bash
node --test test/alpha-ticker-stage-a-boundary.test.ts test/alpha-ticker-stage-a-hosted-boundary.test.ts
node scripts/alpha-ticker-stage-a/check-boundary.mjs
node scripts/alpha-ticker-stage-a-hosted/check-boundary.mjs
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/alpha-ticker-stage-a scripts/alpha-ticker-stage-a-hosted/check-boundary.mjs \
  test/alpha-ticker-stage-a-boundary.test.ts test/alpha-ticker-stage-a-hosted-boundary.test.ts
git commit -m "security: enforce hosted Stage A boundary profile"
```

### Task 6: Add a content-minimized evaluation ledger

**Files:**
- Create: `scripts/alpha-ticker-stage-a-hosted/evaluation-ledger.mjs`
- Create: `test/alpha-ticker-stage-a-hosted-evaluation.test.ts`

- [ ] **Step 1: Write failing schema and threshold tests**

Cover these exact rules:

- Allowed participants: `P1`, `P2`, `P3`.
- Allowed workflows: the five approved workflow ids.
- Scores are integers from 1 through 5.
- Edit burden is `none`, `minor`, `major`, or `rejected`.
- Mandatory disclosure fields are booleans.
- Token counts, elapsed milliseconds, and cost are finite and non-negative.
- Model is exactly `gpt-5.6-terra`.
- Forbidden keys at every depth: `prompt`, `response`, `packetBody`, `providerRequest`, `secret`, `tokenValue`, `email`, `name`.
- A passing summary requires 15 unique workflow-participant pairs, all disclosures true, at least 12 accepted with `none` or `minor`, median usefulness and consistency at least 4, median latency no more than 90,000 ms, total recorded cost no more than US$45, and no incident category other than `none`.

Use this canonical valid record in the test:

```js
const valid = {
  outputId: "P1:daily-portfolio-briefing",
  workflow: "daily-portfolio-briefing",
  participant: "P1",
  sourceTrace: true,
  syntheticDisclosure: true,
  missingDataDisclosure: true,
  humanReviewLanguage: true,
  usefulness: 4,
  factualConsistency: 5,
  editBurden: "minor",
  elapsedMs: 45000,
  inputTokens: 1200,
  outputTokens: 700,
  costUsd: 0.02,
  model: "gpt-5.6-terra",
  deploymentRevision: "a".repeat(40),
  incidentCategory: "none"
};
```

- [ ] **Step 2: Verify the tests fail**

```bash
node --test test/alpha-ticker-stage-a-hosted-evaluation.test.ts
```

Expected: FAIL because the ledger module does not exist.

- [ ] **Step 3: Implement the ledger validator and aggregate**

Export:

```js
export function assertScoreRecord(record) {}
export function summarizeScoreRecords(records) {}
export function readScoreLedger(path) {}
```

`assertScoreRecord` must reject unsupported top-level keys, recursively reject forbidden keys, and enforce every field above. `summarizeScoreRecords` must reject duplicate `outputId` values and return only:

```js
{
  sampleSize,
  disclosurePasses,
  acceptedWithMinorOrLess,
  medianUsefulness,
  medianFactualConsistency,
  medianElapsedMs,
  totalCostUsd,
  incidentCount,
  pass
}
```

Round `totalCostUsd` to six decimal places. `readScoreLedger` parses one JSON object per non-empty line and never logs record bodies.

- [ ] **Step 4: Add the CLI**

When called with `--input .generated/alpha-ticker-stage-a-hosted/scores.jsonl`, print only the aggregate JSON. Exit 0 when `pass` is true and 1 otherwise.

- [ ] **Step 5: Run tests**

```bash
node --test test/alpha-ticker-stage-a-hosted-evaluation.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/alpha-ticker-stage-a-hosted/evaluation-ledger.mjs \
  test/alpha-ticker-stage-a-hosted-evaluation.test.ts
git commit -m "feat: add hosted Stage A evaluation ledger"
```

### Task 7: Add the H0 activation record and preflight

**Files:**
- Create: `scripts/alpha-ticker-stage-a-hosted/activation-record.mjs`
- Create: `scripts/alpha-ticker-stage-a-hosted/preflight.sh`
- Create: `test/alpha-ticker-stage-a-hosted-activation.test.ts`

- [ ] **Step 1: Write failing activation-record tests**

The accepted record has this exact non-secret schema:

```json
{
  "sponsorApproved": true,
  "flyOrg": "personal",
  "flyRegion": "jnb",
  "provider": "openai",
  "providerProjectDedicated": true,
  "providerMaxExposureUsd": 50,
  "autoRecharge": false,
  "retentionReviewed": true,
  "syntheticOnly": true,
  "participantCount": 3,
  "teardownScheduled": true
}
```

Reject extra keys, false controls, different amounts, another region or organization, participant names, email addresses, and any secret-bearing key.

- [ ] **Step 2: Run and verify failure**

```bash
node --test test/alpha-ticker-stage-a-hosted-activation.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the validator**

Export `assertActivationRecord(record)` and a CLI accepting `--input`. Success output is exactly `activation-record: pass`. Failure output names only the invalid field, never its supplied value.

- [ ] **Step 4: Implement read-only preflight**

`preflight.sh` must:

1. Require Node 24.18.1 and npm 11.16.0.
2. Require a clean tracked worktree and a clean hosted boundary scan.
3. Require Docker Buildx and authenticated `fly` without printing identity details.
4. Require `jnb` to appear in `fly platform regions`.
5. Require the exact seven app names to be absent: `alpha-ticker-stage-a-hosted-core`, `-web-ui`, `-admin`, `-portal`, `-auth`, `-sandboxes`, plus `alpha-ticker-stage-a-egress`.
6. Require the exact Managed Postgres name `alpha-ticker-stage-a-hosted-pg` and Tigris bucket name `alpha-ticker-stage-a-hosted-data` to be absent.
7. Validate `.generated/alpha-ticker-stage-a-hosted/activation.json` with `activation-record.mjs`.
8. Require `.env` mode `0600`, Git-ignored, and never print its content.
9. Run `npm exec qm -- check` and `npm exec qm -- sandbox build --dry-run` from the hosted deployment.
10. Run `npm exec qm -- plan`, require the known fail-closed missing-image-pin result, and reject any other result.
11. Print only named check statuses and final `hosted-preflight: pass`.

- [ ] **Step 5: Run local tests without a live activation file**

Unit-test the validator and run the preflight with command shims so region, app/data-resource collision, dirty-worktree, wrong-runtime, and unexpected-plan outcomes each fail closed.

```bash
node --test test/alpha-ticker-stage-a-hosted-activation.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/alpha-ticker-stage-a-hosted/activation-record.mjs \
  scripts/alpha-ticker-stage-a-hosted/preflight.sh \
  test/alpha-ticker-stage-a-hosted-activation.test.ts
git commit -m "ops: add hosted Stage A activation preflight"
```

### Task 8: Add evidence collection and exact-resource teardown controls

**Files:**
- Create: `scripts/alpha-ticker-stage-a-hosted/collect-evidence.mjs`
- Create: `scripts/alpha-ticker-stage-a-hosted/teardown.sh`
- Create: `test/alpha-ticker-stage-a-hosted-evidence.test.ts`
- Create: `test/alpha-ticker-stage-a-hosted-teardown.test.ts`
- Define ignored runtime file: `.generated/alpha-ticker-stage-a-hosted/resource-inventory.json`

- [ ] **Step 1: Write failing evidence tests**

The hosted evidence manifest may contain only:

```text
commit
qmBaseline
sandboxDigest
timestamp
checks
counts
scoreSummary
spendSummary
contentCaptured
```

The manifest must contain aggregate scores only, set `contentCaptured` to false, require three principals and 15 scored outputs, and recursively reject the forbidden ledger keys from Task 6.

- [ ] **Step 2: Write the bounded teardown test**

Require the script to contain exact app names, require `STAGE_A_DESTROY_CONFIRM=alpha-ticker-stage-a-hosted` for execution, support `--dry-run`, call `qm down` before app destruction, and prohibit wildcards, `fly apps destroy --all`, Docker prune, and deletion outside the exact prefix.

- [ ] **Step 3: Verify both tests fail**

```bash
node --test \
  test/alpha-ticker-stage-a-hosted-evidence.test.ts \
  test/alpha-ticker-stage-a-hosted-teardown.test.ts
```

- [ ] **Step 4: Implement hosted evidence collection**

Reuse the hashing and recursive forbidden-key patterns from `scripts/alpha-ticker-stage-a/collect-evidence.mjs`. Hash the activation record, hosted policy, hosted config, sandbox bundle, egress proxy config, evaluation ledger, resource inventory, and live-check result files. Write the manifest mode `0600` under `.generated/alpha-ticker-stage-a-hosted/evidence-manifest.json`. The manifest retains only the resource-inventory hash, never its raw ids.

- [ ] **Step 5: Implement exact app shutdown and destruction**

The script must define this fixed app array:

```bash
APPS=(
  alpha-ticker-stage-a-hosted-core
  alpha-ticker-stage-a-hosted-web-ui
  alpha-ticker-stage-a-hosted-admin
  alpha-ticker-stage-a-hosted-portal
  alpha-ticker-stage-a-hosted-auth
  alpha-ticker-stage-a-hosted-sandboxes
  alpha-ticker-stage-a-egress
)
```

`--dry-run` prints only these names and the two separately managed data resources `alpha-ticker-stage-a-hosted-pg` and `alpha-ticker-stage-a-hosted-data`. Execution runs `npm exec qm -- down`, verifies Fly organization ownership for each existing app, and calls `fly apps destroy "$app" --yes` one at a time. Managed Postgres and Tigris deletion remain explicit Fly-dashboard operations using the exact ids captured in the ignored, mode-`0600` resource inventory; the script must stop with `manual-data-destruction-required` until the operator records both as deleted in the minimized teardown evidence.

- [ ] **Step 6: Run tests**

```bash
node --test \
  test/alpha-ticker-stage-a-hosted-evidence.test.ts \
  test/alpha-ticker-stage-a-hosted-teardown.test.ts
bash scripts/alpha-ticker-stage-a-hosted/teardown.sh --dry-run
```

Expected: tests pass and dry-run lists only the fixed pilot resources.

- [ ] **Step 7: Commit**

```bash
git add scripts/alpha-ticker-stage-a-hosted/collect-evidence.mjs \
  scripts/alpha-ticker-stage-a-hosted/teardown.sh \
  test/alpha-ticker-stage-a-hosted-evidence.test.ts \
  test/alpha-ticker-stage-a-hosted-teardown.test.ts
git commit -m "ops: add hosted Stage A evidence and teardown controls"
```

### Task 9: Write the hosted operations and decision documents

**Files:**
- Create: `docs/alpha-ticker-stage-a-hosted/runbook.md`
- Create: `docs/alpha-ticker-stage-a-hosted/evidence-index.md`
- Create: `docs/alpha-ticker-stage-a-hosted/limitations.md`
- Create: `docs/alpha-ticker-stage-a-hosted/activation-approval.md`
- Create: `docs/alpha-ticker-stage-a-hosted/decision-memo.md`
- Create: `test/alpha-ticker-stage-a-hosted-docs.test.ts`

- [ ] **Step 1: Write failing document-contract tests**

Require the runbook to contain Gates H0 through H5; exact org, app, region, model, harness, budgets, egress proxy and teardown commands; the no-secret-output rule; incident stop conditions; and the statement that Vercel, Railway, Supabase, production data, personal subscriptions, and connectors remain outside scope.

Require limitations to include the upstream command-policy, browser, plaintext-credential, heuristic-screening, retention, budget overshoot, Sprite egress-proxy, unrestricted-core-egress, and empty-allowlist-means-unrestricted limitations.

Require activation approval to distinguish architecture approval from cloud-mutation approval and to state that named reviewers are not a prerequisite.

Require the decision memo to begin in `not-run` status and allow only `stop`, `repeat-synthetic`, or `design-stage-b` as final decisions.

- [ ] **Step 2: Run the test and verify failure**

```bash
node --test test/alpha-ticker-stage-a-hosted-docs.test.ts
```

- [ ] **Step 3: Write the five documents**

Use the approved design as the source of truth. The runbook must include exact repository-only commands, live commands, evidence paths, threshold behavior, revocation sequence, and manual Managed Postgres/Tigris destruction. Do not include email addresses, account identifiers, secret values, prompts, responses, packet bodies, or provider request bodies.

- [ ] **Step 4: Run the document test**

```bash
node --test test/alpha-ticker-stage-a-hosted-docs.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run the complete repository-only gate**

```bash
npm run typecheck
npm run lint
npm run test:all
node --test 'test/alpha-ticker-stage-a-hosted-*.test.ts'
node scripts/alpha-ticker-stage-a/check-boundary.mjs
node scripts/alpha-ticker-stage-a-hosted/check-boundary.mjs
git diff --check
```

Expected: zero failures. Environment-gated upstream skips must be counted and disclosed.

- [ ] **Step 6: Verify hosted static deployment commands**

```bash
cd deploy/layers/alpha-ticker-stage-a-hosted
npm exec qm -- check
npm exec qm -- sandbox build --dry-run
npm exec qm -- plan
```

Expected: check and dry-run pass. Plan must fail closed only because `sandbox.image` has not yet been published and digest-pinned.

- [ ] **Step 7: Commit local readiness**

```bash
git add docs/alpha-ticker-stage-a-hosted test/alpha-ticker-stage-a-hosted-docs.test.ts
git commit -m "docs: add hosted Stage A operating gate"
```

### Task 10: Execute Gate H0 without Fly deployment or model use

**Files:**
- Create locally, ignored: `.generated/alpha-ticker-stage-a-hosted/activation.json`
- Update after pass: `docs/alpha-ticker-stage-a-hosted/activation-approval.md`

- [ ] **Step 1: Install and authenticate the operator tooling**

```bash
brew install flyctl
fly auth whoami >/dev/null
fly orgs list >/dev/null
docker buildx version >/dev/null
```

Do not capture identity output in evidence.

- [ ] **Step 2: Confirm exact Fly capacity and name availability**

```bash
fly platform regions | grep -E '(^|[[:space:]])jnb([[:space:]]|$)' >/dev/null
fly apps list --org personal >/dev/null
fly mpg list --org personal >/dev/null
fly storage list --org personal >/dev/null
```

Use `preflight.sh` for exact app, Managed Postgres, and Tigris collision checks. Any collision is a no-go and requires amended resource names in the design, tests, config, and runbook.

- [ ] **Step 3: Establish provider and SMTP controls outside the repository**

In the provider consoles:

1. Create a dedicated OpenAI project used only for this pilot.
2. Limit maximum authorized exposure to US$50 and disable auto-recharge. A provider dashboard budget or email alert alone does not pass; use prepaid credit with no recharge, an externally capped payment method, or another denial control tested to be hard.
3. Confirm the provider retention and training position has been reviewed.
4. Create or confirm a dedicated, revocable pilot-scoped SMTP credential grant on the existing relay, restricted to authentication links from the approved sender. Do not reuse a production application credential.
5. Confirm exactly three work-email addresses are admitted.

If a reliable US$50 maximum exposure cannot be established, do not create an API key and stop H0.

- [ ] **Step 4: Populate the H0-available secrets locally without printing them**

```bash
cd deploy/layers/alpha-ticker-stage-a-hosted
npm exec qm -- setup
chmod 600 .env
git check-ignore --quiet .env
cd ../../..
```

The operator supplies the values directly. Never paste values into chat, shell history, documentation, tests, or Git.

At H0, explicitly skip `FLY_SANDBOX_API_TOKEN`: its app-scoped token cannot exist until the sandbox registry app is created at H1. The preflight must allow that one known blank while requiring every other H0-available secret. Task 11 completes and verifies the token before image publication.

- [ ] **Step 5: Write and validate the non-secret activation record**

Create the exact JSON from Task 7 at `.generated/alpha-ticker-stage-a-hosted/activation.json`, then run:

```bash
node scripts/alpha-ticker-stage-a-hosted/activation-record.mjs \
  --input .generated/alpha-ticker-stage-a-hosted/activation.json
```

- [ ] **Step 6: Run the full H0 preflight**

```bash
bash scripts/alpha-ticker-stage-a-hosted/preflight.sh
```

Expected final line: `hosted-preflight: pass`.

- [ ] **Step 7: Record H0 outcome**

Update only status, date, commit, and pass/fail check identifiers in `activation-approval.md`. Do not record provider account ids, Fly identity output, addresses, or secret metadata.

- [ ] **Step 8: Commit H0 evidence metadata**

```bash
git add docs/alpha-ticker-stage-a-hosted/activation-approval.md
git commit -m "docs: record hosted Stage A H0 decision"
```

Stop here unless H0 passed every item.

### Task 11: Execute Gate H1, egress proxy and immutable sandbox publication

**Files:**
- Modify automatically: `deploy/layers/alpha-ticker-stage-a-hosted/qm.config.jsonc`
- Update: `docs/alpha-ticker-stage-a-hosted/evidence-index.md`

- [ ] **Step 1: Create the dedicated egress app**

```bash
fly apps create alpha-ticker-stage-a-egress --org personal
```

- [ ] **Step 2: Transfer only the capability secret to the proxy**

From the hosted deployment directory, pipe the one required key without displaying it:

```bash
awk -F= '$1 == "CAPABILITY_SECRET" { print }' .env | \
  fly secrets import -a alpha-ticker-stage-a-egress
```

Verify the command reports the secret name only.

- [ ] **Step 3: Deploy the pinned QM egress proxy implementation**

From the repository root:

```bash
fly deploy . \
  --app alpha-ticker-stage-a-egress \
  --config deploy/layers/alpha-ticker-stage-a-hosted/egress-proxy.fly.toml \
  --dockerfile deploy/egress-proxy/Dockerfile \
  --remote-only \
  --yes
```

- [ ] **Step 4: Prove the authenticated canary positive control and both denials before deploying QM**

```bash
node -- scripts/alpha-ticker-stage-a-hosted/probe-egress.mjs \
  --proxy https://alpha-ticker-stage-a-egress.fly.dev \
  --env-file deploy/layers/alpha-ticker-stage-a-hosted/.env \
  --host example.com
```

Expected: the authenticated canary CONNECT succeeds first, then the unsigned and signed-unapproved-host CONNECTs are denied. Output remains exactly the two denial pass lines defined in Task 3; a failed canary or successful denial request is an immediate no-go.

- [ ] **Step 5: Create and verify the sandbox registry app**

```bash
fly apps create alpha-ticker-stage-a-hosted-sandboxes --org personal
cd deploy/layers/alpha-ticker-stage-a-hosted
npm exec qm -- setup
npm exec qm -- check
```

- [ ] **Step 6: Publish and pin the sandbox once**

```bash
npm exec qm -- sandbox publish
npm exec qm -- check
npm exec qm -- plan
cd ../../..
```

Expected: `qm.config.jsonc` now contains `sandbox.image` as a full `registry.fly.io/...@sha256:` reference; check and plan pass.

- [ ] **Step 7: Re-run local integrity checks and commit the immutable pin**

Before staging, update `evidence-index.md` with the immutable sandbox digest and the H1 check identifiers only. Do not include registry credentials, command output, or account metadata.

```bash
node scripts/alpha-ticker-stage-a-hosted/check-boundary.mjs
node --test 'test/alpha-ticker-stage-a-hosted-*.test.ts'
git diff --check
git add deploy/layers/alpha-ticker-stage-a-hosted/qm.config.jsonc \
  docs/alpha-ticker-stage-a-hosted/evidence-index.md
git commit -m "ops: pin hosted Stage A sandbox image"
```

### Task 12: Execute Gate H2, controlled deployment and live smoke tests

**Files:**
- Write ignored evidence: `.generated/alpha-ticker-stage-a-hosted/live-checks.json`
- Update: `docs/alpha-ticker-stage-a-hosted/evidence-index.md`

- [ ] **Step 1: Push write-only deployment secrets**

```bash
cd deploy/layers/alpha-ticker-stage-a-hosted
npm exec qm -- secrets push
```

- [ ] **Step 2: Review the mutation plan and deploy**

```bash
npm exec qm -- plan
npm exec qm -- up
npm exec qm -- doctor
npm exec qm -- check --live
npm exec qm -- conformance
```

Do not run `qm outputs`: in the pinned release it requires Slack and is invalid for this Slack-free deployment. Record only pass/fail check ids in `live-checks.json`.

- [ ] **Step 3: Restrict org model and harness choices**

Through the Admin interface:

- Before any participant turn, set the durable organization egress allowlist to exactly `alpha-ticker-stage-a-hosted-portal.fly.dev`, set no external-data host, and read the effective policy back. An empty allowlist is an immediate no-go because it is unrestricted in the pinned release.
- Set approved harnesses to only `pi`.
- Set the Web UI model picker to only `gpt-5.6-terra`.
- Confirm model provider is OpenAI and the provider key is sourced from the deployment environment.
- Confirm all connector providers report `configured: false`, an OAuth start attempt fails `not_configured`, and no connector client secret exists in the pilot environment.
- Confirm Slack, public links, browser tooling, and publishing remain unavailable.

- [ ] **Step 4: Prove the three identity boundaries**

Each of the three admitted work identities must sign in separately. A fourth unlisted address must be denied. Confirm `P1`, `P2`, and `P3` each receive a distinct personal scope.

- [ ] **Step 5: Prove a real model response and durable computer**

As `P1`, request a synthetic investment question and require the response to identify the fixture as synthetic and advisory-only. Create a UUID file in the personal workspace only after approving the exact `alpha-packet` command. Independently read the file from the Fly sandbox selected by exact `agent_scope` metadata and compare the UUID.

- [ ] **Step 6: Prove idempotent deployment**

```bash
npm exec qm -- up
npm exec qm -- check --live
npm exec qm -- status
cd ../../..
```

Expected: no duplicate apps, databases, buckets, or sandbox registry.

- [ ] **Step 7: Record content-minimized results**

Write only check ids, status, timestamps, revisions, and resource-name hashes to `live-checks.json`. Separately capture the exact app, Managed Postgres, Tigris, and sandbox-registry ids needed for teardown in `.generated/alpha-ticker-stage-a-hosted/resource-inventory.json`; set mode `0600` and verify it is ignored. Do not store URLs containing tokens, emails, prompts, responses, or model request bodies.

### Task 13: Execute Gate H3 safety drills

**Files:**
- Update ignored evidence: `.generated/alpha-ticker-stage-a-hosted/live-checks.json`
- Update: `docs/alpha-ticker-stage-a-hosted/evidence-index.md`

- [ ] **Step 1: Prove enforced sandbox egress denial**

Ask the agent to run `curl -I https://example.com`, approve only this negative test, and require HTTP 403 from the proxy. Then run one allowed `alpha-packet` fixture command and require success. Any successful external fetch is an immediate teardown trigger.

- [ ] **Step 2: Prove shared-room revocation**

Create one private pilot room containing all three principals, confirm all three can read its synthetic shared artifact, revoke `P2`, and require immediate denial for `P2` while `P1` and `P3` retain access.

- [ ] **Step 3: Prove the budget denial path**

Freeze all pilot turns. Temporarily change `ORG_BUDGET_USD_PER_WINDOW` to `0`, run `npm exec qm -- up --only core`, and confirm the next synthetic turn is denied before any provider request. Restore `45` immediately, run `npm exec qm -- up --only core`, independently inspect the derived core environment, and rerun the hosted policy and boundary tests. Never commit the temporary value. Record only pass/fail and the configured values.

- [ ] **Step 4: Prove provider-key revocation isolation**

Revoke the pilot OpenAI key. Require a new model turn to fail while existing Alpha Ticker provider projects remain unaffected. Mint a replacement key inside the same dedicated pilot project, update `.env` without printing it, run `npm exec qm -- secrets push` followed by `npm exec qm -- up --only core`, and require model health to recover.

- [ ] **Step 5: Prove exact teardown planning**

```bash
bash scripts/alpha-ticker-stage-a-hosted/teardown.sh --dry-run
```

Compare the fixed list against `qm status`, Fly apps, Managed Postgres, and Tigris. Any unowned or unexplained resource blocks evaluation.

- [ ] **Step 6: Decide whether H4 may start**

H4 starts only with zero isolation, egress, budget, revocation, durability, and inventory failures.

### Task 14: Execute Gate H4, the five-day evaluation

**Files:**
- Write ignored: `.generated/alpha-ticker-stage-a-hosted/scores.jsonl`
- Update ignored: `.generated/alpha-ticker-stage-a-hosted/live-checks.json`

- [ ] **Step 1: Start the seven-day budget window clock**

Record the UTC start timestamp in `live-checks.json`. Schedule teardown for the end of the fifth consecutive business day and no later than 168 hours after this timestamp.

- [ ] **Step 2: Complete the 15 required workflow-participant pairs**

Each of `P1`, `P2`, and `P3` runs exactly one scored instance of:

1. `daily-portfolio-briefing`
2. `investment-question`
3. `partner-meeting-preparation`
4. `product-architecture-handover`
5. `decision-memory-draft`

Only synthetic fixture identifiers may be used.

- [ ] **Step 3: Append one minimized score immediately after each run**

Use the schema from Task 6. Never paste the prompt or response into the ledger. Ensure mode `0600` after every write.

- [ ] **Step 4: Evaluate thresholds after every score**

```bash
node scripts/alpha-ticker-stage-a-hosted/evaluation-ledger.mjs \
  --input .generated/alpha-ticker-stage-a-hosted/scores.jsonl
```

Maintain a content-minimized all-turn spend counter covering H2, H3, and H4 from the `pi` cost metadata, and reconcile it after every scored run to the dedicated provider project's aggregate usage. Apply thresholds to the greater observable aggregate; the scored-output ledger alone is not the pilot spend control. At US$33.75, notify the sponsor. At US$40.50, permit only missing required workflow-participant pairs. At US$45, stop all model turns. Any security incident stops the pilot immediately regardless of sample size.

- [ ] **Step 5: Freeze the evaluation**

After all 15 pairs or any stop condition, deny further model use and move directly to H5.

### Task 15: Execute Gate H5, teardown and decision

**Files:**
- Generate ignored: `.generated/alpha-ticker-stage-a-hosted/evidence-manifest.json`
- Update: `docs/alpha-ticker-stage-a-hosted/evidence-index.md`
- Update: `docs/alpha-ticker-stage-a-hosted/decision-memo.md`

- [ ] **Step 1: Generate aggregate evidence before destroying state**

```bash
node scripts/alpha-ticker-stage-a-hosted/collect-evidence.mjs
chmod 600 .generated/alpha-ticker-stage-a-hosted/evidence-manifest.json
```

Verify `contentCaptured` is false and independently calculate the manifest SHA-256.

- [ ] **Step 2: Revoke external credentials first**

Revoke the pilot OpenAI API key, the sandbox-scoped Fly token, and the pilot SMTP credential grant. Do not revoke shared production credentials.

- [ ] **Step 3: Stop and destroy fixed app resources**

```bash
STAGE_A_DESTROY_CONFIRM=alpha-ticker-stage-a-hosted \
  bash scripts/alpha-ticker-stage-a-hosted/teardown.sh --execute
```

Expected: fixed app resources are removed and the script ends with the documented `manual-data-destruction-required` status if either separately managed data resource still exists. Continue only with Step 4; do not treat that bounded stop as permission to skip manual deletion.

- [ ] **Step 4: Delete separately managed data resources**

In the sponsor-controlled Fly organization, use the ignored resource inventory to delete Managed Postgres `alpha-ticker-stage-a-hosted-pg` and private object storage `alpha-ticker-stage-a-hosted-data` through the Fly dashboard. Record only deletion status and timestamp in the teardown evidence.

- [ ] **Step 5: Independently verify absence**

Verify no exact app name remains, no sandbox Sprite with the Stage A prefix remains, and the exact Postgres and object-store resources are absent. Run the teardown script a second time and require an idempotent no-resource result. After the evidence manifest hash is verified, delete the raw resource inventory.

- [ ] **Step 6: Complete the decision memo**

Choose exactly one outcome based on the approved thresholds:

- `stop`
- `repeat-synthetic`
- `design-stage-b`

Report quality, latency, model spend, Fly spend, incidents, limitations, and missing evidence. Do not characterize Stage A as a production-readiness or security certification.

- [ ] **Step 7: Run final repository verification**

```bash
npm run typecheck
npm run lint
npm run test:all
node scripts/alpha-ticker-stage-a/check-boundary.mjs
node scripts/alpha-ticker-stage-a-hosted/check-boundary.mjs
git diff --check
git status --short
```

- [ ] **Step 8: Commit the decision evidence metadata**

```bash
git add docs/alpha-ticker-stage-a-hosted/evidence-index.md \
  docs/alpha-ticker-stage-a-hosted/decision-memo.md
git commit -m "docs: record hosted Stage A decision"
```

Do not commit `.generated`, `.env`, provider output, Fly output, prompts, responses, packet bodies, addresses, or secrets.

## Completion Boundary

This plan is complete only when Gate H5 has destroyed the pilot and the decision memo is committed. A `design-stage-b` outcome authorizes design work only. It does not authorize production data, connectors, Slack, browser access, external actions, or changes to Ticker Alpha's Vercel, Railway, or Supabase systems.
