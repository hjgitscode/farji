import type { Candidate } from "./types";

// CAND-001 is the primary demo candidate shown on the Candidate Dashboard.
// CAND-002 exists only to populate the Issuer Dashboard's pending-requests
// queue with something other than CAND-001's already-verified claims.
export const candidates: Candidate[] = [
  { candidateId: "CAND-001", name: "Aarav Sharma" },
  { candidateId: "CAND-002", name: "Priya Mehta" },
];
