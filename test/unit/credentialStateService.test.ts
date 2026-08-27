import { describe, expect, it } from "vitest";
import { getIssuanceReferenceDate, computeCredentialState } from "@/lib/services/credentialStateService";
import { credentials } from "@/lib/mock-data/credentials";
import type { Credential } from "@/lib/mock-data/types";

const permanentWithEndDate: Credential = {
  credentialId: "CRED-X",
  candidateId: "CAND-X",
  claimType: "DEGREE",
  title: "Test Degree",
  organisationId: "ORG-X",
  lifecycleType: "PERMANENT",
  version: 1,
  previousVersionId: null,
  startDate: "2020-01-01",
  endDate: "2024-01-01",
  state: "PERMANENT_VALID",
};

describe("getIssuanceReferenceDate", () => {
  it("uses endDate for a PERMANENT credential (attested when completed, not when started)", () => {
    expect(getIssuanceReferenceDate(permanentWithEndDate)).toBe("2024-01-01");
  });

  it("falls back to startDate for a PERMANENT credential with no endDate", () => {
    const stillOngoing = { ...permanentWithEndDate, endDate: null };
    expect(getIssuanceReferenceDate(stillOngoing)).toBe("2020-01-01");
  });

  it("uses startDate for a CONTINUING credential", () => {
    const continuing: Credential = { ...permanentWithEndDate, lifecycleType: "CONTINUING" };
    expect(getIssuanceReferenceDate(continuing)).toBe("2020-01-01");
  });

  it("uses startDate for an EXPIRING credential", () => {
    const expiring: Credential = { ...permanentWithEndDate, lifecycleType: "EXPIRING" };
    expect(getIssuanceReferenceDate(expiring)).toBe("2020-01-01");
  });
});

// Regression test: CRED-001 (Aarav Sharma's degree) enrolled in 2022,
// before IIT Delhi Demo Issuer's wallet was authorised (2026-01-01), but
// graduated (endDate) in 2026 — after. Checking issuer authorisation
// against startDate instead of endDate would incorrectly flag this real
// demo credential as INVALID_PROOF.
describe("computeCredentialState — CRED-001 regression", () => {
  it("is PERMANENT_VALID, not INVALID_PROOF", () => {
    const credential = credentials.find((c) => c.credentialId === "CRED-001");
    expect(credential).toBeDefined();
    expect(computeCredentialState(credential!)).toBe("PERMANENT_VALID");
  });
});
