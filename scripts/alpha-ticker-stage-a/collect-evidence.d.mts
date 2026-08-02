export interface EvidenceCheck {
  id: string;
  status: "pass" | "fail";
  artifactSha256: string;
}

export interface EvidenceManifest {
  commit: string;
  qmBaseline: string;
  timestamp: string;
  checks: EvidenceCheck[];
  counts: { tests: number; failures: number; principals: 3 };
  contentCaptured: false;
}

export function assertEvidenceSafe(manifest: unknown): void;
export function buildEvidenceManifest(input: Omit<EvidenceManifest, "contentCaptured">): EvidenceManifest;
export function collectEvidence(input: {
  repoRoot?: string;
  tests: number;
  failures: number;
  timestamp?: string;
}): EvidenceManifest;
