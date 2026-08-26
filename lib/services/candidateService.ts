import { candidates } from "@/lib/mock-data/candidates";
import { credentials } from "@/lib/mock-data/credentials";
import type { Candidate, Credential } from "@/lib/mock-data/types";

export function getCandidates(): Candidate[] {
  return candidates;
}

export function getCandidateById(candidateId: string): Candidate | undefined {
  return candidates.find((c) => c.candidateId === candidateId);
}

export function getCredentialsByCandidate(candidateId: string): Credential[] {
  return credentials.filter((c) => c.candidateId === candidateId);
}

export function getCredentialById(credentialId: string): Credential | undefined {
  return credentials.find((c) => c.credentialId === credentialId);
}

export function getAllCredentials(): Credential[] {
  return credentials;
}
