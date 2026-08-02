export interface BoundaryViolation {
  file: string;
  ruleId: string;
}

export function scanDirectory(root: string): BoundaryViolation[];
export function scanStagedDeploymentDiff(repoRoot?: string, deploymentRoot?: string): BoundaryViolation[];
