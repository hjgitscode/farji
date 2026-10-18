import { describe, expect, it } from "vitest";
import { credentialTermsFrom, validateReviewInput } from "@/lib/core/review";

describe("validateReviewInput", () => {
  it("accepts an approval with optional notes and reference, trimmed", () => {
    const r = validateReviewInput("APPROVE", { notes: "  checked HR system ", sourceOfTruthReference: " HR-1234 " });
    expect(r).toEqual({ ok: true, value: { notes: "checked HR system", sourceOfTruthReference: "HR-1234", rejectionReason: null } });
  });

  it("accepts an approval with nothing, and ignores a smuggled rejection reason", () => {
    const r = validateReviewInput("APPROVE", { rejectionReason: "OTHER" });
    expect(r).toEqual({ ok: true, value: { notes: null, sourceOfTruthReference: null, rejectionReason: null } });
  });

  it("a rejection needs a valid reason code", () => {
    expect(validateReviewInput("REJECT", {})).toMatchObject({ ok: false, errors: { rejectionReason: expect.any(String) } });
    expect(validateReviewInput("REJECT", { rejectionReason: "BECAUSE" })).toMatchObject({ ok: false });
    expect(validateReviewInput("REJECT", { rejectionReason: "DATES_MISMATCH" })).toMatchObject({ ok: true, value: { rejectionReason: "DATES_MISMATCH" } });
  });

  it("OTHER needs an explanation in the notes", () => {
    expect(validateReviewInput("REJECT", { rejectionReason: "OTHER" })).toMatchObject({ ok: false, errors: { notes: expect.any(String) } });
    expect(validateReviewInput("REJECT", { rejectionReason: "OTHER", notes: "Not on payroll" })).toMatchObject({ ok: true });
  });

  it("bounds the lengths of internal fields", () => {
    expect(validateReviewInput("APPROVE", { notes: "x".repeat(2001) })).toMatchObject({ ok: false, errors: { notes: expect.any(String) } });
    expect(validateReviewInput("APPROVE", { sourceOfTruthReference: "x".repeat(501) })).toMatchObject({
      ok: false,
      errors: { sourceOfTruthReference: expect.any(String) },
    });
  });
});

describe("credentialTermsFrom", () => {
  it("PERMANENT and CONTINUING keep their lifecycle type and have no validUntil", () => {
    expect(credentialTermsFrom("PERMANENT", { title: "x" })).toEqual({ lifecycleType: "PERMANENT", validUntil: null });
    expect(credentialTermsFrom("CONTINUING", { title: "x" })).toEqual({ lifecycleType: "CONTINUING", validUntil: null });
  });

  it("12. EXPIRING keeps the expiry date as validUntil (start of that UTC day)", () => {
    const t = credentialTermsFrom("EXPIRING", { expiryDate: "2027-03-31" });
    expect(t?.lifecycleType).toBe("EXPIRING");
    expect(t?.validUntil?.toISOString()).toBe("2027-03-31T00:00:00.000Z");
  });

  it("an EXPIRING version without a valid expiry cannot be issued", () => {
    expect(credentialTermsFrom("EXPIRING", { title: "x" })).toBeNull();
    expect(credentialTermsFrom("EXPIRING", { expiryDate: "2027-02-30" })).toBeNull();
    expect(credentialTermsFrom("EXPIRING", null)).toBeNull();
  });

  it("an unknown lifecycle type cannot be issued", () => {
    expect(credentialTermsFrom("FOREVER", {})).toBeNull();
  });
});
