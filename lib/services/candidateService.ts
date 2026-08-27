import { candidates } from "@/lib/mock-data/candidates";
import { credentials } from "@/lib/mock-data/credentials";
import { withComputedState } from "@/lib/services/credentialStateService";
import type { Candidate, Credential } from "@/lib/mock-data/types";

export function getCandidates(): Candidate[] {
  return candidates;
}

export function getCandidateById(candidateId: string): Candidate | undefined {
  return candidates.find((c) => c.candidateId === candidateId);
}

export function getCredentialsByCandidate(candidateId: string): Credential[] {
  return credentials.filter((c) => c.candidateId === candidateId).map(withComputedState);
}

export function getCredentialById(credentialId: string): Credential | undefined {
  const credential = credentials.find((c) => c.credentialId === credentialId);
  return credential && withComputedState(credential);
}

export function getAllCredentials(): Credential[] {
  return credentials.map(withComputedState);
}
