import { describe, expect, it } from "vitest";
import { isIsoDate, sameDraft, validateClaimDraft } from "@/lib/core/claims";

const NOW = new Date("2026-10-15T12:00:00Z");

const base = {
  category: "EXPERIENCE",
  lifecycleType: "PERMANENT",
  title: "Software Engineer",
  organisationName: "Acme Ltd",
  startDate: "2022-01-10",
  endDate: "2024-03-31",
};

const errorsOf = (raw: Record<string, unknown>, fixed?: "EXPERIENCE") => {
  const r = validateClaimDraft(raw, NOW, fixed);
  return r.ok ? null : r.errors;
};

describe("claim draft validation", () => {
  it("accepts a completed (PERMANENT) experience", () => {
    const r = validateClaimDraft(base, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.content).toMatchObject({ title: "Software Engineer", startDate: "2022-01-10", endDate: "2024-03-31" });
  });

  it("6. rejects an EXPIRING record without an expiry date", () => {
    const e = errorsOf({ ...base, category: "CERTIFICATION", lifecycleType: "EXPIRING", endDate: "" });
    expect(e?.expiryDate).toMatch(/needs an expiry/);
  });

  it("accepts an EXPIRING record with a later expiry date and rejects an end date", () => {
    const ok = { ...base, category: "CERTIFICATION", lifecycleType: "EXPIRING", endDate: "", expiryDate: "2027-03-31" };
    expect(validateClaimDraft(ok, NOW).ok).toBe(true);
    expect(errorsOf({ ...ok, endDate: "2024-01-01" })?.endDate).toBeDefined();
  });

  it("an already-lapsed expiry date is allowed (it will derive EXPIRED later)", () => {
    const lapsed = { ...base, category: "CERTIFICATION", lifecycleType: "EXPIRING", endDate: "", expiryDate: "2025-01-01" };
    expect(validateClaimDraft(lapsed, NOW).ok).toBe(true);
  });

  it("7. rejects invalid date ranges", () => {
    expect(errorsOf({ ...base, endDate: "2021-12-31" })?.endDate).toMatch(/before the start/);
    expect(errorsOf({ ...base, category: "CERTIFICATION", lifecycleType: "EXPIRING", endDate: "", expiryDate: "2022-01-10" })?.expiryDate).toMatch(/after the start/);
  });

  it("7. rejects impossible and malformed dates", () => {
    expect(errorsOf({ ...base, startDate: "2026-02-30" })?.startDate).toMatch(/valid date/);
    expect(errorsOf({ ...base, startDate: "10/01/2022" })?.startDate).toMatch(/valid date/);
    expect(errorsOf({ ...base, endDate: "not-a-date" })?.endDate).toMatch(/valid date/);
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2025-02-29")).toBe(false);
  });

  it("rejects a future start date and a completed record that ends in the future", () => {
    expect(errorsOf({ ...base, startDate: "2027-01-01", endDate: "2027-06-01" })?.startDate).toMatch(/future/);
    expect(errorsOf({ ...base, endDate: "2027-01-01" })?.endDate).toMatch(/future/);
  });

  it("a PERMANENT record is not treated as current: it needs an end date", () => {
    expect(errorsOf({ ...base, endDate: "" })?.endDate).toMatch(/needs an end date/);
  });

  it("a PERMANENT certification that never lapses needs no end date", () => {
    expect(validateClaimDraft({ ...base, category: "CERTIFICATION", endDate: "" }, NOW).ok).toBe(true);
  });

  it("a CONTINUING record is not forced to have an end date, and cannot carry one", () => {
    const current = { ...base, lifecycleType: "CONTINUING", endDate: "" };
    const r = validateClaimDraft(current, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.content).not.toHaveProperty("endDate");
    expect(errorsOf({ ...current, endDate: "2024-01-01" })?.endDate).toBeDefined();
  });

  it("an expiry date is only allowed on EXPIRING records", () => {
    expect(errorsOf({ ...base, expiryDate: "2030-01-01" })?.expiryDate).toBeDefined();
  });

  it("requires title and organisation, and bounds lengths", () => {
    expect(errorsOf({ ...base, title: "  " })?.title).toMatch(/required/);
    expect(errorsOf({ ...base, organisationName: "" })?.organisationName).toMatch(/required/);
    expect(errorsOf({ ...base, title: "x".repeat(201) })?.title).toMatch(/at most/);
  });

  it("rejects unknown category and lifecycle values", () => {
    expect(errorsOf({ ...base, category: "SELF_DECLARED" })?.category).toBeDefined();
    expect(errorsOf({ ...base, lifecycleType: "FOREVER" })?.lifecycleType).toBeDefined();
  });

  it("a fixed (stored) category wins over the submitted one", () => {
    const r = validateClaimDraft({ ...base, category: "EDUCATION" }, NOW, "EXPERIENCE");
    expect(r.ok && r.value.category).toBe("EXPERIENCE");
  });

  it("never copies unknown or hidden fields into stored content", () => {
    const r = validateClaimDraft({ ...base, userId: "u-1", role: "ADMIN", candidateId: "x", organisationId: "o", verified: true }, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const stored = JSON.stringify(r.value);
      expect(stored).not.toMatch(/userId|role|candidateId|organisationId|verified/);
    }
  });

  it("keeps category-specific fields only for their category", () => {
    const r = validateClaimDraft({ ...base, fieldOfStudy: "CS", credentialNumber: "123" }, NOW);
    expect(r.ok && r.value.content).not.toHaveProperty("fieldOfStudy");
    expect(r.ok && r.value.content).not.toHaveProperty("credentialNumber");
    const edu = validateClaimDraft({ ...base, category: "EDUCATION", fieldOfStudy: "CS" }, NOW);
    expect(edu.ok && edu.value.content.fieldOfStudy).toBe("CS");
  });

  it("sameDraft ignores key order but sees real changes", () => {
    const a = { lifecycleType: "PERMANENT", content: { title: "A", startDate: "2022-01-01" } };
    expect(sameDraft(a, { lifecycleType: "PERMANENT", content: { startDate: "2022-01-01", title: "A" } })).toBe(true);
    expect(sameDraft(a, { lifecycleType: "PERMANENT", content: { title: "B", startDate: "2022-01-01" } })).toBe(false);
    expect(sameDraft(a, { lifecycleType: "CONTINUING", content: a.content })).toBe(false);
  });
});
