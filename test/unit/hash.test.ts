import { describe, expect, it } from "vitest";
import { hashCredential, keccak256Utf8 } from "@/lib/crypto/hash";
import type { CanonicalCredentialInput } from "@/lib/crypto/types";

const base: CanonicalCredentialInput = {
  credentialId: "CRED-001",
  candidateRef: "CAND-001",
  claimType: "EMPLOYMENT",
  organisationId: "ORG-XYZ",
  title: "Software Engineer",
  startDate: "2026-06-15",
  endDate: null,
  lifecycleType: "CONTINUING",
  version: 1,
};

describe("keccak256Utf8", () => {
  // The well-known Keccak-256 (not NIST SHA3-256) digest of the empty
  // string. Ethereum's keccak256 predates the NIST SHA-3 standardisation
  // and uses different padding, so the two algorithms disagree on this
  // exact value — this test proves we're using the one the EVM uses.
  it("matches the known Keccak-256 digest of the empty string", () => {
    expect(keccak256Utf8("")).toBe(
      "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
    );
  });

  it("is deterministic for the same input", () => {
    expect(keccak256Utf8("hello")).toBe(keccak256Utf8("hello"));
  });
});

describe("hashCredential", () => {
  it("returns a 32-byte hex string", () => {
    const hash = hashCredential(base);
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("is deterministic regardless of input key order", () => {
    const shuffled: CanonicalCredentialInput = {
      version: 1,
      lifecycleType: "CONTINUING",
      endDate: null,
      startDate: "2026-06-15",
      title: "Software Engineer",
      organisationId: "ORG-XYZ",
      claimType: "EMPLOYMENT",
      candidateRef: "CAND-001",
      credentialId: "CRED-001",
    };
    expect(hashCredential(shuffled)).toBe(hashCredential(base));
  });

  it.each<[string, Partial<CanonicalCredentialInput>]>([
    ["credentialId", { credentialId: "CRED-002" }],
    ["candidateRef", { candidateRef: "CAND-002" }],
    ["claimType", { claimType: "CERTIFICATION" }],
    ["organisationId", { organisationId: "ORG-ABC" }],
    ["title", { title: "Senior Software Engineer" }],
    ["startDate", { startDate: "2026-07-01" }],
    ["endDate", { endDate: "2027-01-01" }],
    ["lifecycleType", { lifecycleType: "EXPIRING" }],
    ["version", { version: 2 }],
  ])("changes the hash when %s changes", (_field, change) => {
    const changed: CanonicalCredentialInput = { ...base, ...change };
    expect(hashCredential(changed)).not.toBe(hashCredential(base));
  });
});
