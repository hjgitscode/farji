import { attestations } from "@/lib/mock-data/attestations";
import type { Attestation, AttestationType } from "@/lib/mock-data/types";

export function getAttestations(organisationId?: string, type?: AttestationType): Attestation[] {
  return attestations.filter(
    (a) =>
      (!organisationId || a.organisationId === organisationId) &&
      (!type || a.attestationType === type),
  );
}

export function getAttestationById(attestationId: string): Attestation | undefined {
  return attestations.find((a) => a.attestationId === attestationId);
}

export function getLatestAttestation(
  organisationId: string,
  type: AttestationType,
): Attestation | undefined {
  const matches = getAttestations(organisationId, type);
  return matches.sort((a, b) => b.epoch - a.epoch)[0];
}
