export interface BoundaryViolation {
  file: string;
  ruleId: string;
}

export interface BoundaryOptions {
  allowedPublicUrls?: Set<string>;
}

export function scanDirectory(root: string, options?: BoundaryOptions): BoundaryViolation[];
export function scanStagedDeploymentDiff(
  repoRoot?: string,
  deploymentRoot?: string,
  options?: BoundaryOptions,
): BoundaryViolation[];
