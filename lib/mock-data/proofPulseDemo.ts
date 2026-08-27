import { credentials } from "./credentials";
import { toCanonicalInput } from "@/lib/crypto/fromMockCredential";
import type { CanonicalCredentialInput } from "@/lib/crypto/types";

// Dedicated illustrative dataset for the /proofpulse walkthrough page.
// "Credential B" is deliberately Aarav Sharma's real CRED-002 employment
// claim, so the demo page ties back to the Candidate Dashboard. Every
// entry carries a full canonical claim so the batch builds into a real
// Merkle tree — see lib/services/proofPulseService.ts.
export interface ProofPulseLeaf {
  id: string;
  label: string;
  claim: CanonicalCredentialInput;
}

const aaravEmployment = credentials.find((c) => c.credentialId === "CRED-002");
if (!aaravEmployment) {
  throw new Error("Expected CRED-002 (Aarav Sharma's employment) in mock credentials");
}

function otherEmployee(id: string, title: string): ProofPulseLeaf {
  return {
    id,
    label: `Credential ${id.slice(-1)}`,
    claim: {
      credentialId: `CRED-${id}`,
      candidateRef: `CAND-${id}`,
      claimType: "EMPLOYMENT",
      organisationId: "ORG-XYZ",
      title,
      startDate: "2026-03-01",
      endDate: null,
      lifecycleType: "CONTINUING",
      version: 1,
    },
  };
}

export const augustLeaves: ProofPulseLeaf[] = [
  otherEmployee("PP-A", "Backend Engineer"),
  { id: "PP-B", label: "Credential B — Aarav Sharma, Software Engineer", claim: toCanonicalInput(aaravEmployment) },
  otherEmployee("PP-C", "QA Engineer"),
  otherEmployee("PP-D", "DevOps Engineer"),
];

// September's active set omits Credential B. Per the project's core
// design rule, this must read as "not recently re-attested," never as
// "employment ended" — that transition requires a separate explicit action.
export const septemberLeaves: ProofPulseLeaf[] = augustLeaves.filter((leaf) => leaf.id !== "PP-B");

export const AUGUST_ATTESTATION_LABEL = "August 2026 ProofPulse";
export const AUGUST_ANCHORED_AT = "2026-08-01";
export const SEPTEMBER_ATTESTATION_LABEL = "September 2026 ProofPulse";
export const SEPTEMBER_ANCHORED_AT = "2026-09-01";
