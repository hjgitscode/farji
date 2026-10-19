import { describe, expect, it } from "vitest";
import {
  checkKeyForNewAttestation,
  isKeyAuthorisedAt,
  isKeyCompromisedAt,
  wasKeyValidForAttestation,
  wasKeyValidForEvidence,
  type IssuerKeyHistory,
} from "@/lib/crypto/keys";

const d = (iso: string) => new Date(iso);
const FROM = d("2026-01-01T00:00:00Z");
const UNTIL = d("2026-06-01T00:00:00Z");

const open: IssuerKeyHistory = { validFrom: FROM, validUntil: null, compromisedAt: null };
const retired: IssuerKeyHistory = { validFrom: FROM, validUntil: UNTIL, compromisedAt: null };

describe("isKeyAuthorisedAt (validFrom <= t < validUntil)", () => {
  it("is false before validFrom, true exactly at validFrom", () => {
    expect(isKeyAuthorisedAt(open, d("2025-12-31T23:59:59Z"))).toBe(false);
    expect(isKeyAuthorisedAt(open, FROM)).toBe(true);
  });

  it("an open key stays authorised for any later time", () => {
    expect(isKeyAuthorisedAt(open, d("2099-01-01T00:00:00Z"))).toBe(true);
  });

  it("a retired key is authorised just before validUntil and NOT at validUntil", () => {
    expect(isKeyAuthorisedAt(retired, d("2026-05-31T23:59:59Z"))).toBe(true);
    expect(isKeyAuthorisedAt(retired, UNTIL)).toBe(false);
    expect(isKeyAuthorisedAt(retired, d("2026-06-01T00:00:01Z"))).toBe(false);
  });
});

describe("compromise", () => {
  const compromised: IssuerKeyHistory = { validFrom: FROM, validUntil: UNTIL, compromisedAt: d("2026-04-01T00:00:00Z") };

  it("is effective from compromisedAt (inclusive)", () => {
    expect(isKeyCompromisedAt(compromised, d("2026-03-31T23:59:59Z"))).toBe(false);
    expect(isKeyCompromisedAt(compromised, d("2026-04-01T00:00:00Z"))).toBe(true);
    expect(isKeyCompromisedAt(open, d("2099-01-01T00:00:00Z"))).toBe(false);
  });

  it("evidence signed before the compromise stays historically valid, after it does not", () => {
    expect(wasKeyValidForAttestation(compromised, d("2026-03-31T23:59:59Z"))).toBe(true);
    expect(wasKeyValidForAttestation(compromised, d("2026-04-01T00:00:00Z"))).toBe(false);
  });
});

describe("historical validity survives retirement", () => {
  it("a signature made while the key was valid is still valid after the key is retired", () => {
    const issuedAt = d("2026-03-01T00:00:00Z");
    expect(wasKeyValidForAttestation(retired, issuedAt)).toBe(true); // judged at issuedAt, not "now"
  });

  it("a signature claiming a time after retirement or before authorisation is never valid", () => {
    expect(wasKeyValidForAttestation(retired, d("2026-07-01T00:00:00Z"))).toBe(false);
    expect(wasKeyValidForAttestation(retired, d("2025-12-01T00:00:00Z"))).toBe(false);
  });
});

describe("checkKeyForNewAttestation", () => {
  const issuedAt = d("2026-03-01T00:00:00Z");

  it("accepts an open, uncompromised key authorised at issuedAt", () => {
    expect(checkKeyForNewAttestation(open, issuedAt, d("2026-03-01T00:01:00Z"))).toBeNull();
  });

  it("refuses a key not yet valid at the signed issuedAt", () => {
    expect(checkKeyForNewAttestation(open, d("2025-12-31T00:00:00Z"), d("2026-03-01T00:00:00Z"))).toBe("NOT_AUTHORISED_AT_ISSUANCE");
  });

  it("refuses a retired key for a NEW attestation, even though issuedAt fell inside its period", () => {
    expect(checkKeyForNewAttestation(retired, issuedAt, d("2026-07-01T00:00:00Z"))).toBe("NOT_CURRENTLY_AUTHORISED");
  });

  it("refuses any compromised key, whenever the compromise happened", () => {
    const compromised: IssuerKeyHistory = { validFrom: FROM, validUntil: null, compromisedAt: d("2026-09-01T00:00:00Z") };
    expect(checkKeyForNewAttestation(compromised, issuedAt, d("2026-03-01T00:00:00Z"))).toBe("COMPROMISED");
  });

  it("refuses a backdated issuedAt before the key existed", () => {
    expect(checkKeyForNewAttestation(open, d("2025-01-01T00:00:00Z"), d("2026-03-01T00:00:00Z"))).toBe("NOT_AUTHORISED_AT_ISSUANCE");
  });
});

describe("wasKeyValidForEvidence (compromise judged at ANCHOR time, mirrors the contract)", () => {
  const compromised: IssuerKeyHistory = { validFrom: FROM, validUntil: UNTIL, compromisedAt: d("2026-04-01T00:00:00Z") };
  const issuedAt = d("2026-03-01T00:00:00Z");

  it("evidence anchored before the compromise stays valid, at or after it does not - however the issuedAt was chosen", () => {
    expect(wasKeyValidForEvidence(compromised, issuedAt, d("2026-03-31T23:59:59Z"))).toBe(true);
    expect(wasKeyValidForEvidence(compromised, issuedAt, d("2026-04-01T00:00:00Z"))).toBe(false);
    expect(wasKeyValidForEvidence(compromised, issuedAt, d("2026-05-01T00:00:00Z"))).toBe(false);
  });

  it("a later retirement never invalidates evidence; a key not yet authorised at issuedAt is invalid", () => {
    expect(wasKeyValidForEvidence(retired, issuedAt, d("2027-01-01T00:00:00Z"))).toBe(true);
    expect(wasKeyValidForEvidence(open, d("2025-01-01T00:00:00Z"), d("2026-02-01T00:00:00Z"))).toBe(false);
    expect(wasKeyValidForEvidence(retired, d("2026-07-01T00:00:00Z"), d("2026-07-02T00:00:00Z"))).toBe(false);
  });
});
