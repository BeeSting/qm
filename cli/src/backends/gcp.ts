import { CliError } from "../log.ts";
import { httpDeploymentLayerTransport, type DeploymentLayerTransport } from "../deployment-layer.ts";
import type { Backend } from "./types.ts";
import type { DeployContext } from "./registry.ts";

/**
 * GCP target skeleton. The config block, scaffold, and validation are live;
 * the deploy path (Cloud Run up/status/logs/down, native-revision rollback,
 * Secret Manager push) lands in a following change, as does the Terraform
 * module behind `qm infra`. Until then every operation says so explicitly.
 */
const notImplemented = (operation: string): never => {
  throw new CliError(
    `qm ${operation} is not implemented for target "gcp" yet — this release scaffolds and validates the GCP deployment repository only; the Cloud Run deploy path lands in a following release`,
  );
};

/**
 * Deployment-layer transport for GCP: signed HTTP to the public core URL.
 * Cloud Run fronts the core with a public HTTPS endpoint, so the default
 * publicUrl-derived route applies; a Secret Manager fallback for
 * CORE_SIGNING_SECRET arrives with the deploy path.
 */
export const gcpDeploymentLayerTransport: DeploymentLayerTransport = httpDeploymentLayerTransport({
  timeoutMs: 60_000,
});

export const createGcpBackend = (_ctx: DeployContext): Backend => ({
  up: () => notImplemented("up"),
  status: () => notImplemented("status"),
  logs: () => notImplemented("logs"),
  down: () => notImplemented("down"),
  rollback: () => notImplemented("rollback"),
  doctor: () => notImplemented("doctor"),
  secretsPush: () => notImplemented("secrets push"),
  pinSandbox: () => notImplemented("sandbox pin"),
});
