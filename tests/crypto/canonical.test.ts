import { describe, expect, it } from "vitest";
import { canonicalCredentialContent, CONTENT_KEYS } from "@/lib/crypto/canonical";
import { contentDigestOf } from "@/lib/crypto/commitments";
import { rep } from "../vectors/inputs";

const SALT = rep("bb");

const BASE = { title: "Software Engineer", organisationName: "Acme Ltd", startDate: "2022-01-10", endDate: "2024-03-31" };

const ok = (category: Parameters<typeof canonicalCredentialContent>[0], lifecycle: Parameters<typeof canonicalCredentialContent>[1], content: unknown) => {
  const r = canonicalCredentialContent(category, lifecycle, content);
  if (!r.ok) throw new Error("expected ok: " + JSON.stringify(r.errors));
  return r.value;
};
const errors = (category: Parameters<typeof canonicalCredentialContent>[0], lifecycle: Parameters<typeof canonicalCredentialContent>[1], content: unknown) => {
  const r = canonicalCredentialContent(category, lifecycle, content);
  if (r.ok) throw new Error("expected errors");
  return r.errors;
};
const digest = (c: ReturnType<typeof ok>) => contentDigestOf(c, SALT);

describe("canonicalisation determinism", () => {
  it("is independent of key order and produces every key, empty when absent", () => {
    const a = ok("EXPERIENCE", "PERMANENT", BASE);
    const b = ok("EXPERIENCE", "PERMANENT", { endDate: "2024-03-31", startDate: "2022-01-10", organisationName: "Acme Ltd", title: "Software Engineer" });
    expect(a).toEqual(b);
    expect(digest(a)).toBe(digest(b));
    expect(a.category).toBe(0);
    expect(a.expiryDate).toBe("");
    expect(a.description).toBe("");
    expect(Object.keys(a)).toEqual(["category", ...CONTENT_KEYS]);
  });

  it("NFC and NFD forms of the same text are equivalent", () => {
    const composed = ok("EXPERIENCE", "PERMANENT", { ...BASE, title: "Café Manager" });
    const decomposed = ok("EXPERIENCE", "PERMANENT", { ...BASE, title: "Café Manager" });
    expect(composed.title).toBe("Café Manager");
    expect(digest(composed)).toBe(digest(decomposed));
  });

  it("trims, treats absent/null/empty alike, and normalises line endings in the description", () => {
    const a = ok("EXPERIENCE", "PERMANENT", { ...BASE, title: "  Software Engineer \t".trim(), description: "  one\r\ntwo\rthree  " });
    expect(a.description).toBe("one\ntwo\nthree");
    const withNull = ok("EXPERIENCE", "PERMANENT", { ...BASE, location: null, description: undefined });
    const withEmpty = ok("EXPERIENCE", "PERMANENT", { ...BASE, location: "", description: "   " });
    expect(digest(withNull)).toBe(digest(withEmpty));
  });
});

describe("every field affects the digest (and the salt and category do too)", () => {
  const variants: [string, [Parameters<typeof ok>[0], Parameters<typeof ok>[1]], Record<string, string>][] = [
    ["title", ["EXPERIENCE", "PERMANENT"], { title: "Senior Software Engineer" }],
    ["organisationName", ["EXPERIENCE", "PERMANENT"], { organisationName: "Acme Limited" }],
    ["startDate", ["EXPERIENCE", "PERMANENT"], { startDate: "2022-01-11" }],
    ["endDate", ["EXPERIENCE", "PERMANENT"], { endDate: "2024-04-01" }],
    ["description", ["EXPERIENCE", "PERMANENT"], { description: "Built things" }],
    ["location", ["EXPERIENCE", "PERMANENT"], { location: "Pune" }],
    ["fieldOfStudy", ["EDUCATION", "PERMANENT"], { fieldOfStudy: "Computer Science" }],
    ["credentialNumber", ["CERTIFICATION", "PERMANENT"], { credentialNumber: "ABC-123" }],
    ["expiryDate", ["CERTIFICATION", "EXPIRING"], { expiryDate: "2027-03-31" }],
  ];
  for (const [key, [category, lifecycle], change] of variants) {
    it(`changing ${key} changes the digest`, () => {
      const base = lifecycle === "EXPIRING" ? { title: "Licence", organisationName: "Board", startDate: "2022-01-10", expiryDate: "2026-03-31" } : BASE;
      const a = ok(category, lifecycle, base);
      const b = ok(category, lifecycle, { ...base, ...change });
      expect(digest(a)).not.toBe(digest(b));
    });
  }

  it("the category and the contentSalt change the digest", () => {
    const a = ok("EXPERIENCE", "PERMANENT", BASE);
    const b = ok("MEMBERSHIP", "PERMANENT", BASE);
    expect(digest(a)).not.toBe(digest(b));
    expect(contentDigestOf(a, rep("bb"))).not.toBe(contentDigestOf(a, rep("bc")));
  });
});

describe("strict validation fails closed", () => {
  it("rejects unknown keys instead of ignoring them", () => {
    expect(errors("EXPERIENCE", "PERMANENT", { ...BASE, salary: "1" })).toHaveProperty("salary");
    expect(errors("EXPERIENCE", "PERMANENT", { ...BASE, verified: "true" })).toHaveProperty("verified");
  });

  it("rejects non-object content and non-string values", () => {
    for (const bad of [null, undefined, "x", 3, [], [BASE]]) {
      expect(errors("EXPERIENCE", "PERMANENT", bad)).toHaveProperty("content");
    }
    expect(errors("EXPERIENCE", "PERMANENT", { ...BASE, title: 5 })).toHaveProperty("title");
    expect(errors("EXPERIENCE", "PERMANENT", { ...BASE, location: { a: 1 } })).toHaveProperty("location");
  });

  it("requires title, organisationName and startDate", () => {
    expect(errors("EXPERIENCE", "PERMANENT", { ...BASE, title: " " })).toHaveProperty("title");
    expect(errors("EXPERIENCE", "PERMANENT", { ...BASE, organisationName: undefined })).toHaveProperty("organisationName");
    expect(errors("EXPERIENCE", "PERMANENT", { ...BASE, startDate: "" })).toHaveProperty("startDate");
  });

  it("accepts only strict calendar dates", () => {
    for (const bad of ["2022-1-10", "10/01/2022", "2026-02-30", "2022-01-10T00:00:00Z", "tomorrow"]) {
      expect(errors("EXPERIENCE", "PERMANENT", { ...BASE, startDate: bad })).toHaveProperty("startDate");
    }
    expect(errors("EXPERIENCE", "PERMANENT", { ...BASE, endDate: "2024-02-30" })).toHaveProperty("endDate");
  });

  it("rejects control characters, multi-line single-line fields and malformed Unicode", () => {
    expect(errors("EXPERIENCE", "PERMANENT", { ...BASE, title: "A\u0000B" })).toHaveProperty("title");
    expect(errors("EXPERIENCE", "PERMANENT", { ...BASE, title: "A​B\u0085C" })).toHaveProperty("title"); // NEL (C1)
    expect(errors("EXPERIENCE", "PERMANENT", { ...BASE, title: "Line one\nLine two" })).toHaveProperty("title");
    expect(errors("EXPERIENCE", "PERMANENT", { ...BASE, organisationName: "Tab\there" })).toHaveProperty("organisationName");
    expect(errors("EXPERIENCE", "PERMANENT", { ...BASE, title: "lone \ud800 surrogate" })).toHaveProperty("title");
    expect(ok("EXPERIENCE", "PERMANENT", { ...BASE, description: "a\tb\nc" }).description).toBe("a\tb\nc");
  });

  it("bounds field length", () => {
    expect(errors("EXPERIENCE", "PERMANENT", { ...BASE, description: "x".repeat(4001) })).toHaveProperty("description");
  });
});

describe("lifecycle- and category-specific fields", () => {
  it("only a PERMANENT record has an end date", () => {
    expect(errors("EXPERIENCE", "CONTINUING", BASE)).toHaveProperty("endDate");
    expect(errors("CERTIFICATION", "EXPIRING", { ...BASE, expiryDate: "2027-03-31" })).toHaveProperty("endDate");
    expect(ok("EXPERIENCE", "CONTINUING", { ...BASE, endDate: "" }).endDate).toBe("");
  });

  it("an EXPIRING record needs an expiry date and no other lifecycle may carry one", () => {
    const noEnd = { title: "Licence", organisationName: "Board", startDate: "2022-01-10" };
    expect(errors("CERTIFICATION", "EXPIRING", noEnd)).toHaveProperty("expiryDate");
    expect(ok("CERTIFICATION", "EXPIRING", { ...noEnd, expiryDate: "2027-03-31" }).expiryDate).toBe("2027-03-31");
    expect(errors("CERTIFICATION", "PERMANENT", { ...noEnd, expiryDate: "2027-03-31" })).toHaveProperty("expiryDate");
    expect(errors("MEMBERSHIP", "CONTINUING", { ...noEnd, expiryDate: "2027-03-31" })).toHaveProperty("expiryDate");
  });

  it("fieldOfStudy is EDUCATION only and credentialNumber is CERTIFICATION only", () => {
    expect(errors("EXPERIENCE", "PERMANENT", { ...BASE, fieldOfStudy: "CS" })).toHaveProperty("fieldOfStudy");
    expect(ok("EDUCATION", "PERMANENT", { ...BASE, fieldOfStudy: "CS" }).fieldOfStudy).toBe("CS");
    expect(errors("EDUCATION", "PERMANENT", { ...BASE, credentialNumber: "1" })).toHaveProperty("credentialNumber");
    expect(ok("CERTIFICATION", "PERMANENT", { ...BASE, credentialNumber: "1" }).credentialNumber).toBe("1");
  });

  it("maps each category to its fixed code", () => {
    const code = (c: Parameters<typeof ok>[0]) => ok(c, "PERMANENT", BASE).category;
    expect([code("EXPERIENCE"), code("EDUCATION"), code("CERTIFICATION"), code("MEMBERSHIP")]).toEqual([0, 1, 2, 3]);
  });
});
