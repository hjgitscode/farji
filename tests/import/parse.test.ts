import { describe, expect, it } from "vitest";
import { validateClaimDraft } from "@/lib/core/claims";
import { IMPORT_LIMITS, parseCsv, parseLooseDate, parseProfileImport, recordKey, type ImportDraft } from "@/lib/import/parse";

const NOW = new Date("2026-10-20T10:00:00Z");
const parse = (text: string) => parseProfileImport(text, NOW);
const issueFields = (d: ImportDraft) => d.issues.map((i) => i.field);

describe("date reading never guesses", () => {
  it("reads the common forms", () => {
    expect(parseLooseDate("Jan 2024")).toEqual({ kind: "month", iso: "2024-01-01", year: 2024, month: 1 });
    expect(parseLooseDate("January 2024")).toMatchObject({ kind: "month", iso: "2024-01-01" });
    expect(parseLooseDate("Sept 2023")).toMatchObject({ kind: "month", iso: "2023-09-01" });
    expect(parseLooseDate("2024")).toEqual({ kind: "year", year: 2024 });
    expect(parseLooseDate("2024-03")).toMatchObject({ kind: "month", iso: "2024-03-01" });
    expect(parseLooseDate("03/2024")).toMatchObject({ kind: "month", iso: "2024-03-01" });
    expect(parseLooseDate("2024-03-15")).toEqual({ kind: "day", iso: "2024-03-15" });
    expect(parseLooseDate("15 Mar 2024")).toEqual({ kind: "day", iso: "2024-03-15" });
    expect(parseLooseDate("Mar 15, 2024")).toEqual({ kind: "day", iso: "2024-03-15" });
    for (const w of ["Present", "present", "Current", "now"]) expect(parseLooseDate(w)).toEqual({ kind: "present" });
  });

  it("refuses ambiguous or impossible dates", () => {
    for (const bad of ["01/02/2024", "2024-13", "2024-02-30", "Foo 2024", "sometime", "", "99", "1850"]) expect(parseLooseDate(bad).kind).toBe("none");
  });
});

const TEXT = `Experience
Software Engineer
Acme Ltd · Full-time
Jan 2022 - Present · 4 yrs 9 mos
Bengaluru, India
Built and ran the payments platform.

Education
Example University
Bachelor of Technology, Computer Science
2016 - 2020

Licenses & Certifications
AWS Certified Solutions Architect
Amazon Web Services
Issued Jan 2023 · Expires Jan 2026
Credential ID ABC-123

Memberships
Fellow
British Computer Society
Mar 2019 - Present

Skills
Python
`;

describe("pasted profile text", () => {
  const r = parse(TEXT);
  const [exp, edu, cert, mem] = r.drafts;

  it("finds each category and skips sections that are not records", () => {
    expect(r.format).toBe("text");
    expect(r.drafts.map((d) => d.category)).toEqual(["EXPERIENCE", "EDUCATION", "CERTIFICATION", "MEMBERSHIP"]);
    expect(r.warnings.join(" ")).toContain("Skills");
    expect(new Set(r.drafts.map((d) => d.key)).size).toBe(4);
  });

  it("parses a current experience and suggests CONTINUING (to be confirmed)", () => {
    expect(exp).toMatchObject({ title: "Software Engineer", organisationName: "Acme Ltd", lifecycleType: "CONTINUING", location: "Bengaluru, India", description: "Built and ran the payments platform.", endDate: "" });
    expect(exp.startDate).toBe("2022-01-01");
    expect(issueFields(exp)).toContain("startDate"); // month only: the day is flagged, not silently trusted
    expect(issueFields(exp)).toContain("lifecycleType");
  });

  it("parses education, never inventing a month or day from a year", () => {
    expect(edu).toMatchObject({ organisationName: "Example University", title: "Bachelor of Technology", fieldOfStudy: "Computer Science", lifecycleType: "PERMANENT" });
    expect(edu.startDate).toBe("");
    expect(edu.endDate).toBe("");
    expect(edu.issues.filter((i) => i.field === "startDate" || i.field === "endDate").every((i) => i.message.includes("Only the year"))).toBe(true);
  });

  it("parses a certification with an explicit expiry as EXPIRING", () => {
    expect(cert).toMatchObject({ title: "AWS Certified Solutions Architect", organisationName: "Amazon Web Services", lifecycleType: "EXPIRING", credentialNumber: "ABC-123", startDate: "2023-01-01", expiryDate: "2026-01-01" });
  });

  it("parses a current membership as CONTINUING", () => {
    expect(mem).toMatchObject({ title: "Fellow", organisationName: "British Computer Society", lifecycleType: "CONTINUING", startDate: "2019-03-01" });
  });

  it("a certification with no expiry is suggested as not lapsing, with a flag", () => {
    const d = parse("Certifications\nFirst Aid\nRed Cross\nIssued Mar 2020").drafts[0];
    expect(d.lifecycleType).toBe("PERMANENT");
    expect(d.expiryDate).toBe("");
    expect(issueFields(d)).toContain("lifecycleType");
  });

  it("does not guess when a record has no end date or 'present'", () => {
    const d = parse("Experience\nAnalyst\nGlobex\n2019-05-01 - ").drafts;
    // an unreadable range yields no date line: nothing is invented
    expect(d[0].startDate).toBe("");
    expect(d[0].lifecycleType).toBe("");
    const e = parse("Memberships\nMember\nSome Society\nSince Mar 2019").drafts[0];
    expect(e.startDate).toBe("2019-03-01");
    expect(e.lifecycleType).toBe(""); // current or ended is not stated
    expect(issueFields(e)).toContain("lifecycleType");
  });

  it("an end date in the future suggests an ongoing record; a year not yet past asks the person to choose", () => {
    const future = parse("Education\nExample University\nMSc, Data Science\nSep 2025 - Jun 2027").drafts[0];
    expect(future.lifecycleType).toBe("CONTINUING");
    expect(future.endDate).toBe("");
    const thisYear = parse("Experience\nEngineer\nInitech\nMar 2020 - 2026").drafts[0];
    expect(thisYear.lifecycleType).toBe("");
  });

  it("reads exact dates exactly and keeps the end after the start", () => {
    const d = parse("Experience\nEngineer\nInitech\n2020-03-10 - 2021-04-12").drafts[0];
    expect(d).toMatchObject({ startDate: "2020-03-10", endDate: "2021-04-12", lifecycleType: "PERMANENT" });
    expect(d.issues.filter((i) => i.field === "startDate" || i.field === "endDate")).toEqual([]);
    const bad = parse("Experience\nEngineer\nInitech\n2022-03-10 - 2021-04-12").drafts[0];
    expect(bad.issues.some((i) => i.message.includes("before the start"))).toBe(true);
  });

  it("text with no headings yields nothing rather than a guess", () => {
    const r2 = parse("I worked at Acme from 2020 to 2022 as an engineer.");
    expect(r2.drafts).toEqual([]);
    expect(r2.warnings[0]).toContain("No section headings");
  });

  it("unknown fields are never fabricated: missing values stay empty and flagged", () => {
    const d = parse("Experience\nJust A Title").drafts[0];
    expect(d).toMatchObject({ title: "Just A Title", organisationName: "", startDate: "", endDate: "", lifecycleType: "", description: "", location: "" });
    expect(issueFields(d)).toEqual(expect.arrayContaining(["organisationName", "startDate"]));
  });

  it("empty or oversized input is handled without throwing", () => {
    expect(parse("").warnings[0]).toContain("Nothing to import");
    expect(parseProfileImport("x".repeat(IMPORT_LIMITS.maxChars + 1), NOW).drafts).toEqual([]);
  });
});

describe("CSV", () => {
  it("reads quoted fields, embedded commas and newlines, a BOM and CRLF", () => {
    const rows = parseCsv('﻿a,b,c\r\n"x, y","line1\nline2","he said ""hi"""\r\n');
    expect(rows).toEqual([["a", "b", "c"], ["x, y", "line1\nline2", 'he said "hi"']]);
  });

  it("LinkedIn Positions: a blank 'Finished On' is current, a month is flagged", () => {
    const csv = `Company Name,Title,Description,Location,Started On,Finished On
Acme Ltd,Engineer,"Built, shipped",Pune,Jan 2022,
Globex,Analyst,,Delhi,Mar 2018,Feb 2020
`;
    const [current, done] = parse(csv).drafts;
    expect(parse(csv).format).toBe("csv");
    expect(current).toMatchObject({ category: "EXPERIENCE", title: "Engineer", organisationName: "Acme Ltd", description: "Built, shipped", location: "Pune", lifecycleType: "CONTINUING", startDate: "2022-01-01" });
    expect(done).toMatchObject({ lifecycleType: "PERMANENT", startDate: "2018-03-01", endDate: "2020-02-01" });
    expect(issueFields(done)).toEqual(expect.arrayContaining(["startDate", "endDate"]));
  });

  it("LinkedIn Education: the degree is the title, the school the organisation", () => {
    const csv = `School Name,Start Date,End Date,Notes,Degree Name,Activities
Example University,2016-08-01,2020-05-30,Honours,Bachelor of Science,Chess
`;
    expect(parse(csv).drafts[0]).toMatchObject({ category: "EDUCATION", title: "Bachelor of Science", organisationName: "Example University", startDate: "2016-08-01", endDate: "2020-05-30", lifecycleType: "PERMANENT", description: "Honours" });
  });

  it("LinkedIn Certifications: 'Finished On' is the expiry; blank means it does not lapse", () => {
    const csv = `Name,Url,Authority,Started On,Finished On,License Number
Cloud Practitioner,https://x.example,Amazon Web Services,Feb 2024,Feb 2027,L-77
First Aid,,Red Cross,Mar 2020,,
`;
    const [a, b] = parse(csv).drafts;
    expect(a).toMatchObject({ category: "CERTIFICATION", lifecycleType: "EXPIRING", expiryDate: "2027-02-01", credentialNumber: "L-77", organisationName: "Amazon Web Services" });
    expect(b).toMatchObject({ lifecycleType: "PERMANENT", expiryDate: "" });
  });

  it("a generic CSV with a category column, and an unknown category left for the person", () => {
    const csv = `category,title,organisation,start date,end date
Membership,Member,Guild,2020-01-15,
Unknown thing,Whatever,Somewhere,2020-01-15,2021-01-15
`;
    const [m, u] = parse(csv).drafts;
    expect(m).toMatchObject({ category: "MEMBERSHIP", title: "Member" });
    expect(u.category).toBe("");
    expect(issueFields(u)).toContain("category");
  });

  it("caps the number of records and warns", () => {
    const rows = Array.from({ length: IMPORT_LIMITS.maxItems + 20 }, (_, i) => `Co${i},Role${i},Jan 2020,Feb 2021`).join("\n");
    const r = parse(`Company Name,Title,Started On,Finished On\n${rows}`);
    expect(r.drafts).toHaveLength(IMPORT_LIMITS.maxItems);
    expect(r.warnings.join(" ")).toContain("first");
  });
});

describe("a draft is only a proposal: Phase 4 validation still decides", () => {
  it("a fully specified draft passes validateClaimDraft; an incomplete one does not", () => {
    const ok = parse("Experience\nEngineer\nInitech\n2020-03-10 - 2021-04-12").drafts[0];
    expect(validateClaimDraft(ok as unknown as Record<string, unknown>, NOW).ok).toBe(true);
    const incomplete = parse(TEXT).drafts[1]; // year-only dates left empty
    expect(validateClaimDraft(incomplete as unknown as Record<string, unknown>, NOW).ok).toBe(false);
  });
});

describe("duplicate identity", () => {
  it("ignores case, punctuation, spacing and diacritics", () => {
    const a = recordKey({ category: "EXPERIENCE", title: "Software  Engineer", organisationName: "Acmé Ltd.", startDate: "2020-01-01", endDate: "2021-01-01" });
    const b = recordKey({ category: "EXPERIENCE", title: "software engineer", organisationName: "ACME LTD", startDate: "2020-01-01", endDate: "2021-01-01" });
    expect(a).toBe(b);
    expect(recordKey({ category: "EDUCATION", title: "x", organisationName: "y", startDate: "2020-01-01" })).not.toBe(recordKey({ category: "EXPERIENCE", title: "x", organisationName: "y", startDate: "2020-01-01" }));
    expect(a).not.toBe(recordKey({ category: "EXPERIENCE", title: "Software Engineer", organisationName: "Acme Ltd", startDate: "2020-02-01", endDate: "2021-01-01" }));
  });
});
