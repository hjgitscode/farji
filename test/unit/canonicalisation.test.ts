import { describe, expect, it } from "vitest";
import { canonicalise, canonicaliseCredential } from "@/lib/crypto/canonicalise";
import type { CanonicalCredentialInput } from "@/lib/crypto/types";

const base: CanonicalCredentialInput = {
  credentialId: "CRED-001",
  candidateRef: "CAND-001",
  claimType: "employment",
  organisationId: "ORG-XYZ",
  title: "  Software   Engineer ",
  startDate: "2026-06-15",
  endDate: null,
  lifecycleType: "continuing",
  version: 1,
};

describe("canonicaliseCredential", () => {
  it("uppercases enum fields regardless of input casing", () => {
    const result = canonicaliseCredential(base);
    expect(result.claimType).toBe("EMPLOYMENT");
    expect(result.lifecycleType).toBe("CONTINUING");
  });

  it("normalises whitespace in free-text fields", () => {
    const result = canonicaliseCredential(base);
    expect(result.title).toBe("Software Engineer");
  });

  it("represents a missing endDate explicitly as null", () => {
    const { endDate: _endDate, ...withoutEndDate } = base;
    const result = canonicaliseCredential(withoutEndDate as CanonicalCredentialInput);
    expect(result.endDate).toBeNull();
  });

  it("rejects an unrecognised claim type", () => {
    expect(() => canonicaliseCredential({ ...base, claimType: "HOBBY" })).toThrow();
  });

  it("rejects an unrecognised lifecycle type", () => {
    expect(() => canonicaliseCredential({ ...base, lifecycleType: "TEMPORARY" })).toThrow();
  });

  it("rejects a non-positive or non-integer version", () => {
    expect(() => canonicaliseCredential({ ...base, version: 0 })).toThrow();
    expect(() => canonicaliseCredential({ ...base, version: 1.5 })).toThrow();
  });

  it("rejects a malformed date", () => {
    expect(() => canonicaliseCredential({ ...base, startDate: "15-06-2026" })).toThrow();
  });

  it("rejects an empty id field", () => {
    expect(() => canonicaliseCredential({ ...base, credentialId: "   " })).toThrow();
  });
});

describe("canonicalise (deterministic serialisation)", () => {
  it("produces the same canonical string regardless of input key order", () => {
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

    expect(canonicalise(shuffled)).toBe(canonicalise(base));
  });

  it("produces the same canonical string for inputs that only differ in whitespace/casing", () => {
    const noisy: CanonicalCredentialInput = {
      ...base,
      claimType: "  Employment ",
      lifecycleType: "Continuing",
      title: "Software Engineer",
    };

    expect(canonicalise(noisy)).toBe(canonicalise(base));
  });

  it("produces a different canonical string when a field actually differs", () => {
    const changed: CanonicalCredentialInput = { ...base, title: "Senior Software Engineer" };
    expect(canonicalise(changed)).not.toBe(canonicalise(base));
  });

  it("serialises fields in the fixed canonical order", () => {
    const parsed = JSON.parse(canonicalise(base));
    expect(Object.keys(parsed)).toEqual([
      "credentialId",
      "candidateRef",
      "claimType",
      "organisationId",
      "title",
      "startDate",
      "endDate",
      "lifecycleType",
      "version",
    ]);
  });
});
