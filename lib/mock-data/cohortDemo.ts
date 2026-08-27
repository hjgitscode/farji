import { credentials } from "./credentials";
import { toCanonicalInput } from "@/lib/crypto/fromMockCredential";
import type { CanonicalCredentialInput } from "@/lib/crypto/types";

// Dedicated illustrative dataset for the /cohortproof walkthrough page.
// "Student A" is deliberately Aarav Sharma's real CRED-001 degree claim,
// so the demo page ties back to the Candidate Dashboard. Every student
// carries a full canonical claim (not just a label) so the whole batch
// hashes and builds into a real Merkle tree — see lib/services/
// cohortService.ts, which is what actually builds the tree from this data.
export interface CohortLeaf {
  id: string;
  label: string;
  claim: CanonicalCredentialInput;
}

const aaravDegree = credentials.find((c) => c.credentialId === "CRED-001");
if (!aaravDegree) {
  throw new Error("Expected CRED-001 (Aarav Sharma's degree) in mock credentials");
}

export const cohortStudents: CohortLeaf[] = [
  {
    id: "STU-A",
    label: "Student A — Aarav Sharma, B.Tech Computer Science",
    claim: toCanonicalInput(aaravDegree),
  },
  {
    id: "STU-B",
    label: "Student B",
    claim: {
      credentialId: "CRED-STUDENT-B",
      candidateRef: "CAND-STUDENT-B",
      claimType: "DEGREE",
      organisationId: "ORG-IITD",
      title: "B.Tech Computer Science",
      startDate: "2022-08-01",
      endDate: "2026-06-01",
      lifecycleType: "PERMANENT",
      version: 1,
    },
  },
  {
    id: "STU-C",
    label: "Student C",
    claim: {
      credentialId: "CRED-STUDENT-C",
      candidateRef: "CAND-STUDENT-C",
      claimType: "DEGREE",
      organisationId: "ORG-IITD",
      title: "B.Tech Electrical Engineering",
      startDate: "2022-08-01",
      endDate: "2026-06-01",
      lifecycleType: "PERMANENT",
      version: 1,
    },
  },
  {
    id: "STU-D",
    label: "Student D",
    claim: {
      credentialId: "CRED-STUDENT-D",
      candidateRef: "CAND-STUDENT-D",
      claimType: "DEGREE",
      organisationId: "ORG-IITD",
      title: "B.Tech Mechanical Engineering",
      startDate: "2022-08-01",
      endDate: "2026-06-01",
      lifecycleType: "PERMANENT",
      version: 1,
    },
  },
];

export const COHORT_ATTESTATION_LABEL = "2026 Graduation Cohort";
export const COHORT_ANCHORED_AT = "2026-06-05";
