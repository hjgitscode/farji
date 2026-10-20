import type { ClaimCategoryName, LifecycleTypeName } from "@/lib/core/claims";
import { isIsoDate } from "@/lib/core/claims";

// Deterministic professional-profile importer (ROADMAP Phase 11). PURE: no I/O, no clock (`now` is passed), no network,
// no AI service, no scraping and no LinkedIn API. It reads text the candidate pasted or a CSV they uploaded and proposes
// drafts. It NEVER fabricates: anything it cannot read exactly is left empty with an `issue`, and a precise FARJI date is
// only filled in when the source gave one. Everything it produces is UNVERIFIED input for the candidate to confirm.

export type ImportField = "category" | "lifecycleType" | "title" | "organisationName" | "startDate" | "endDate" | "expiryDate" | "description" | "location" | "fieldOfStudy" | "credentialNumber";

export type ImportIssue = { field: ImportField; message: string; raw?: string };

export type ImportDraft = {
  /** Stable within one preview ("i0", "i1", ...). */
  key: string;
  category: ClaimCategoryName | "";
  /** "" means the importer could not suggest a lifecycle: the candidate must choose. */
  lifecycleType: LifecycleTypeName | "";
  title: string;
  organisationName: string;
  startDate: string;
  endDate: string;
  expiryDate: string;
  description: string;
  location: string;
  fieldOfStudy: string;
  credentialNumber: string;
  issues: ImportIssue[];
  /** What the draft was read from (shortened), so the candidate can compare. */
  source: string;
};

export type ParseResult = { format: "csv" | "text"; drafts: ImportDraft[]; warnings: string[] };

export const IMPORT_LIMITS = { maxChars: 200_000, maxItems: 100, maxSource: 500 } as const;

// ───────────────────────────── dates ─────────────────────────────

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

export type LooseDate =
  | { kind: "present" }
  | { kind: "day"; iso: string }
  | { kind: "month"; iso: string; year: number; month: number }
  | { kind: "year"; year: number }
  | { kind: "none" };

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Reads the date forms people actually write: `Jan 2024`, `January 2024`, `2024`, `2024-03`, `03/2024`,
 * `15 Mar 2024`, `Mar 15, 2024`, `2024-03-15`, and `Present`/`Current`. Ambiguous numeric forms such as `01/02/2024`
 * are NOT guessed (kind "none"). A month-only date keeps `iso` = the 1st of the month; callers must flag that.
 */
export function parseLooseDate(raw: string): LooseDate {
  const s = raw.trim().replace(/\.$/, "").replace(/\s+/g, " ");
  if (!s) return { kind: "none" };
  if (/^(present|current|now|ongoing|today)$/i.test(s)) return { kind: "present" };

  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return isIsoDate(s) ? { kind: "day", iso: s } : { kind: "none" };

  m = /^(\d{4})-(\d{2})$/.exec(s);
  if (m) {
    const month = Number(m[2]);
    return month >= 1 && month <= 12 ? { kind: "month", iso: `${m[1]}-${m[2]}-01`, year: Number(m[1]), month } : { kind: "none" };
  }

  m = /^(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) {
    const month = Number(m[1]);
    return month >= 1 && month <= 12 ? { kind: "month", iso: `${m[2]}-${pad(month)}-01`, year: Number(m[2]), month } : { kind: "none" };
  }

  m = /^([A-Za-z]{3,9})\.?,? (\d{4})$/.exec(s);
  if (m && MONTHS[m[1].toLowerCase()]) {
    const month = MONTHS[m[1].toLowerCase()];
    return { kind: "month", iso: `${m[2]}-${pad(month)}-01`, year: Number(m[2]), month };
  }

  m = /^(\d{1,2}) ([A-Za-z]{3,9})\.?,? (\d{4})$/.exec(s);
  if (m && MONTHS[m[2].toLowerCase()]) {
    const iso = `${m[3]}-${pad(MONTHS[m[2].toLowerCase()])}-${pad(Number(m[1]))}`;
    return isIsoDate(iso) ? { kind: "day", iso } : { kind: "none" };
  }

  m = /^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})$/.exec(s);
  if (m && MONTHS[m[1].toLowerCase()]) {
    const iso = `${m[3]}-${pad(MONTHS[m[1].toLowerCase()])}-${pad(Number(m[2]))}`;
    return isIsoDate(iso) ? { kind: "day", iso } : { kind: "none" };
  }

  m = /^(\d{4})$/.exec(s);
  if (m && Number(m[1]) >= 1900 && Number(m[1]) <= 2200) return { kind: "year", year: Number(m[1]) };

  return { kind: "none" };
}

// ───────────────────────────── drafting ─────────────────────────────

type Raw = {
  category: ClaimCategoryName | "";
  title: string;
  organisationName: string;
  start: string;
  end: string;
  /** Certification expiry or an explicit "expires" value. */
  expiry: string;
  /** The source row says "no end date means current" (LinkedIn positions export, "Present" in text). */
  blankEndMeansCurrent: boolean;
  description: string;
  location: string;
  fieldOfStudy: string;
  credentialNumber: string;
  source: string;
};

const clip = (s: string) => (s.length > IMPORT_LIMITS.maxSource ? s.slice(0, IMPORT_LIMITS.maxSource) + "…" : s);

/** Turns what was read into a draft: reads dates carefully, suggests (never asserts) a lifecycle, records issues. */
function draftFrom(raw: Raw, key: string, today: string): ImportDraft {
  const issues: ImportIssue[] = [];
  const d: ImportDraft = {
    key,
    category: raw.category,
    lifecycleType: "",
    title: raw.title.trim(),
    organisationName: raw.organisationName.trim(),
    startDate: "",
    endDate: "",
    expiryDate: "",
    description: raw.description.trim(),
    location: raw.location.trim(),
    fieldOfStudy: raw.category === "EDUCATION" ? raw.fieldOfStudy.trim() : "",
    credentialNumber: raw.category === "CERTIFICATION" ? raw.credentialNumber.trim() : "",
    issues,
    source: clip(raw.source),
  };
  if (!d.category) issues.push({ field: "category", message: "Choose what kind of record this is." });
  if (!d.title) issues.push({ field: "title", message: "No title was found. Enter one." });
  if (!d.organisationName) issues.push({ field: "organisationName", message: "No organisation was found. Enter one." });

  const readDate = (field: ImportField, value: string, role: string): LooseDate => {
    if (!value.trim()) return { kind: "none" };
    const p = parseLooseDate(value);
    if (p.kind === "none") issues.push({ field, message: `The ${role} could not be read exactly. Enter it as a full date.`, raw: value.trim() });
    return p;
  };

  // start
  const start = readDate("startDate", raw.start, "start date");
  if (!raw.start.trim()) issues.push({ field: "startDate", message: "No start date was found. Enter one." });
  if (start.kind === "day") d.startDate = start.iso;
  else if (start.kind === "month") {
    d.startDate = start.iso;
    issues.push({ field: "startDate", message: "Only the month was given, so the 1st of the month is filled in. Confirm or correct the day.", raw: raw.start.trim() });
  } else if (start.kind === "year") {
    issues.push({ field: "startDate", message: `Only the year (${start.year}) was given. Enter the full start date.`, raw: raw.start.trim() });
  } else if (start.kind === "present") {
    issues.push({ field: "startDate", message: "A start date cannot be \"present\". Enter the start date.", raw: raw.start.trim() });
  }
  if (d.startDate && d.startDate > today) issues.push({ field: "startDate", message: "The start date is in the future. FARJI records start in the past.", raw: raw.start.trim() });

  const expiry = readDate("expiryDate", raw.expiry, "expiry date");
  const end = readDate("endDate", raw.end, "end date");

  if (d.category === "CERTIFICATION") {
    const noExpiry = /^(no expir|does not expire|never|none)/i.test(raw.expiry.trim());
    if (expiry.kind === "day" || expiry.kind === "month") {
      d.lifecycleType = "EXPIRING";
      d.expiryDate = expiry.iso;
      if (expiry.kind === "month") issues.push({ field: "expiryDate", message: "Only the month was given, so the 1st of the month is filled in. Confirm or correct the day.", raw: raw.expiry.trim() });
    } else if (expiry.kind === "year") {
      d.lifecycleType = "EXPIRING";
      issues.push({ field: "expiryDate", message: `Only the year (${expiry.year}) was given. Enter the full expiry date.`, raw: raw.expiry.trim() });
    } else if (expiry.kind === "none" && raw.expiry.trim() && !noExpiry) {
      // unreadable text: lifecycle left for the candidate
    } else {
      d.lifecycleType = "PERMANENT";
      issues.push({ field: "lifecycleType", message: "No expiry date was stated, so this is suggested as a certification that does not lapse. Confirm." });
    }
    return d;
  }

  // EXPERIENCE / EDUCATION / MEMBERSHIP / unknown category
  if (end.kind === "present") {
    d.lifecycleType = "CONTINUING";
    issues.push({ field: "lifecycleType", message: "Marked as current, so this is suggested as an ongoing record. Confirm." });
  } else if (end.kind === "day" || end.kind === "month") {
    if (end.iso > today) {
      d.lifecycleType = "CONTINUING";
      issues.push({ field: "lifecycleType", message: "The end date is in the future, so this is suggested as an ongoing record. Confirm." });
    } else {
      d.lifecycleType = "PERMANENT";
      d.endDate = end.iso;
      if (end.kind === "month") issues.push({ field: "endDate", message: "Only the month was given, so the 1st of the month is filled in. Confirm or correct the day.", raw: raw.end.trim() });
      if (d.startDate && d.endDate < d.startDate) issues.push({ field: "endDate", message: "The end date is before the start date.", raw: raw.end.trim() });
    }
  } else if (end.kind === "year") {
    const thisYear = Number(today.slice(0, 4));
    if (end.year < thisYear) {
      d.lifecycleType = "PERMANENT";
      issues.push({ field: "endDate", message: `Only the year (${end.year}) was given. Enter the full end date.`, raw: raw.end.trim() });
    } else {
      issues.push({ field: "lifecycleType", message: `The end year (${end.year}) is not in the past, so it is unclear whether this has finished. Choose.` });
    }
  } else if (!raw.end.trim()) {
    if (raw.blankEndMeansCurrent) {
      d.lifecycleType = "CONTINUING";
      issues.push({ field: "lifecycleType", message: "There is no end date, so this is suggested as an ongoing record. Confirm." });
    } else {
      issues.push({ field: "lifecycleType", message: "There is no end date or \"present\". Choose whether this is completed or ongoing." });
    }
  } else {
    issues.push({ field: "lifecycleType", message: "The end date could not be read, so the type is not suggested. Choose." });
  }
  return d;
}

// ───────────────────────────── CSV ─────────────────────────────

/** RFC 4180-style CSV reader: quotes, escaped quotes, embedded newlines, BOM, CRLF. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"' && field === "") inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const norm = (h: string) => h.trim().toLowerCase().replace(/[_\s]+/g, " ");
const pick = (row: Record<string, string>, names: string[]) => {
  for (const n of names) if (row[n] !== undefined && row[n].trim() !== "") return row[n];
  return "";
};

const CATEGORY_WORDS: Record<string, ClaimCategoryName> = {
  experience: "EXPERIENCE", employment: "EXPERIENCE", job: "EXPERIENCE", position: "EXPERIENCE", work: "EXPERIENCE",
  education: "EDUCATION", degree: "EDUCATION", school: "EDUCATION",
  certification: "CERTIFICATION", certificate: "CERTIFICATION", licence: "CERTIFICATION", license: "CERTIFICATION", licences: "CERTIFICATION",
  membership: "MEMBERSHIP", member: "MEMBERSHIP", affiliation: "MEMBERSHIP",
};

function parseCsvImport(text: string, today: string): ParseResult {
  const rows = parseCsv(text);
  const warnings: string[] = [];
  if (rows.length < 2) return { format: "csv", drafts: [], warnings: ["The file has a header but no records."] };
  const header = rows[0].map(norm);
  const has = (...names: string[]) => names.some((n) => header.includes(n));

  const inferred: ClaimCategoryName | "" = has("school name", "school", "degree name") ? "EDUCATION" : has("authority", "license number", "licence number", "credential id") ? "CERTIFICATION" : has("company name", "company", "employer") ? "EXPERIENCE" : "";
  const linkedInPositions = has("company name") && has("started on");
  const drafts: ImportDraft[] = [];

  for (let r = 1; r < rows.length; r++) {
    if (drafts.length >= IMPORT_LIMITS.maxItems) {
      warnings.push(`Only the first ${IMPORT_LIMITS.maxItems} records were read.`);
      break;
    }
    const row: Record<string, string> = {};
    header.forEach((h, i) => (row[h] = rows[r][i] ?? ""));

    const catCell = norm(pick(row, ["category", "type", "kind"]));
    const category = CATEGORY_WORDS[catCell] ?? inferred;
    const isCert = category === "CERTIFICATION";
    const isEdu = category === "EDUCATION";
    const rawEnd = pick(row, ["end date", "finished on", "end", "to", "ended", "end year"]);
    const explicitExpiry = pick(row, ["expiry date", "expiry", "expires", "expiration date", "expires on", "valid until"]);

    drafts.push(
      draftFrom(
        {
          category,
          title: pick(row, isEdu ? ["degree name", "degree", "title", "name"] : ["title", "position", "role", "name", "degree name"]),
          organisationName: pick(row, ["organisation", "organization", "company name", "company", "employer", "school name", "school", "institution", "authority", "issuer", "issuing organisation", "issuing organization"]),
          start: pick(row, ["start date", "started on", "start", "from", "issued", "issue date", "issued on", "start year"]),
          end: isCert ? "" : rawEnd,
          expiry: isCert ? explicitExpiry || rawEnd : explicitExpiry,
          blankEndMeansCurrent: linkedInPositions,
          description: pick(row, ["description", "notes", "summary"]),
          location: pick(row, ["location"]),
          fieldOfStudy: pick(row, ["field of study", "field", "major"]),
          credentialNumber: pick(row, ["license number", "licence number", "credential number", "credential id", "number"]),
          source: `Row ${r + 1}: ${rows[r].join(" | ")}`,
        },
        `i${drafts.length}`,
        today,
      ),
    );
  }
  return { format: "csv", drafts, warnings };
}

// ───────────────────────────── pasted text ─────────────────────────────

const SECTION_HEADINGS: [RegExp, ClaimCategoryName | "SKIP"][] = [
  [/^(work |professional )?experience$|^employment( history)?$/i, "EXPERIENCE"],
  [/^education$/i, "EDUCATION"],
  [/^(licen[sc]es?( (&|and) certifications?)?|certifications?|licen[sc]es?)$/i, "CERTIFICATION"],
  [/^(professional )?(memberships?|affiliations?)$/i, "MEMBERSHIP"],
  [/^(about|summary|skills|top skills|projects|languages|honou?rs( (&|and) awards)?|awards|volunteer(ing)?( experience)?|recommendations|interests|publications|courses|patents|contact|activity|featured)$/i, "SKIP"],
];

function headingOf(line: string): ClaimCategoryName | "SKIP" | null {
  const t = line.trim();
  if (t.length > 40) return null;
  for (const [re, cat] of SECTION_HEADINGS) if (re.test(t)) return cat;
  return null;
}

/** A line that carries dates: `Jan 2022 - Present · 2 yrs`, `2016 - 2020`, `Issued Jan 2023 · Expires Jan 2026`, `Since 2020`. */
function readDateLine(line: string): { start: string; end: string; expiry: string; kind: "range" | "issued" | "since" } | null {
  const t = line.trim();
  const issued = /^issued[:\s]+(.+)$/i.exec(t);
  if (issued) {
    const parts = issued[1].split(/\s+·\s+|\s+\|\s+/);
    const start = parts[0].trim();
    let expiry = "";
    for (const p of parts.slice(1)) {
      const e = /^(?:expires?|expiry|valid until)[:\s]+(.+)$/i.exec(p.trim());
      if (e) expiry = e[1].trim();
      else if (/^no expir/i.test(p.trim())) expiry = "No expiration";
    }
    return parseLooseDate(start).kind === "none" ? null : { start, end: "", expiry, kind: "issued" };
  }
  const since = /^(?:member )?since[:\s]+(.+)$/i.exec(t);
  if (since) return parseLooseDate(since[1]).kind === "none" ? null : { start: since[1].trim(), end: "", expiry: "", kind: "since" };

  const first = t.split(/\s+·\s+/)[0];
  const range = /^(.+?)\s+(?:-|–|—|to)\s+(.+)$/i.exec(first);
  if (!range) return null;
  const a = parseLooseDate(range[1]);
  const b = parseLooseDate(range[2]);
  if (a.kind === "none" || a.kind === "present" || b.kind === "none") return null;
  return { start: range[1].trim(), end: range[2].trim(), expiry: "", kind: "range" };
}

const stripType = (s: string) => s.split(/\s+·\s+/)[0].trim();
const LOCATIONISH = /,|\bremote\b|\bhybrid\b|\bon-?site\b/i;

function parseTextImport(text: string, today: string): ParseResult {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/\s+/g, " ").trim());
  const warnings: string[] = [];
  const skipped = new Set<string>();
  const drafts: ImportDraft[] = [];

  let section: ClaimCategoryName | "SKIP" | null = null;
  let block: string[] = [];
  let sawHeading = false;

  const flush = () => {
    const b = block.filter((l) => !/^(show (all|more|credential)|see more|…see more|\.\.\.see more)$/i.test(l));
    block = [];
    if (b.length === 0 || section === null || section === "SKIP") return;
    if (drafts.length >= IMPORT_LIMITS.maxItems) return;
    const dateIdx = b.findIndex((l) => readDateLine(l) !== null);
    const source = b.join("\n");
    if (dateIdx === -1) {
      // No date line: keep what is certain (the lines) and require everything else.
      drafts.push(draftFrom({ category: section, title: b[0] ?? "", organisationName: stripType(b[1] ?? ""), start: "", end: "", expiry: "", blankEndMeansCurrent: false, description: b.slice(2).join("\n"), location: "", fieldOfStudy: "", credentialNumber: "", source }, `i${drafts.length}`, today));
      drafts[drafts.length - 1].issues.push({ field: "startDate", message: "No dates were found in this entry." });
      return;
    }
    const dl = readDateLine(b[dateIdx])!;
    const before = b.slice(0, dateIdx);
    const after = b.slice(dateIdx + 1);
    let title = before[0] ?? "";
    let org = stripType(before[1] ?? "");
    let fieldOfStudy = "";
    const extraIssues: ImportIssue[] = [];

    if (section === "EDUCATION") {
      // School first, then the degree line.
      org = stripType(before[0] ?? "");
      title = before[1] ?? "";
      const commas = title.split(", ");
      if (commas.length === 2) {
        title = commas[0].trim();
        fieldOfStudy = commas[1].trim();
        extraIssues.push({ field: "fieldOfStudy", message: "The field of study was split from the degree line at the comma. Check both.", raw: before[1] });
      }
    } else if (section === "CERTIFICATION") {
      title = before[0] ?? "";
      org = stripType(before[1] ?? "");
    } else {
      extraIssues.push({ field: "organisationName", message: "Taken from the line after the title. Check it is the right organisation.", raw: before[1] });
    }
    if (before.length > 2) extraIssues.push({ field: "title", message: "Extra lines appeared before the dates. Check the title and organisation.", raw: before.join(" / ") });

    let credentialNumber = "";
    const rest: string[] = [];
    for (const l of after) {
      const cid = /^credential id[:\s]+(.+)$/i.exec(l);
      if (cid && section === "CERTIFICATION") credentialNumber = cid[1].trim();
      else rest.push(l);
    }
    let location = "";
    if (section !== "CERTIFICATION" && rest[0] && rest[0].length <= 80 && LOCATIONISH.test(rest[0]) && !/[.!?]$/.test(rest[0])) location = rest.shift()!;

    const draft = draftFrom(
      {
        category: section,
        title,
        organisationName: org,
        start: dl.start,
        end: dl.end,
        expiry: dl.expiry,
        blankEndMeansCurrent: false,
        description: section === "CERTIFICATION" ? "" : rest.join("\n"),
        location,
        fieldOfStudy,
        credentialNumber,
        source,
      },
      `i${drafts.length}`,
      today,
    );
    draft.issues.push(...extraIssues);
    if (b.filter((l) => readDateLine(l) !== null).length > 1) draft.issues.push({ field: "title", message: "This entry seems to contain several records. Separate records with a blank line." });
    drafts.push(draft);
  };

  for (const line of lines) {
    const h = line ? headingOf(line) : null;
    if (h) {
      flush();
      sawHeading = true;
      section = h;
      if (h === "SKIP") skipped.add(line.trim());
      continue;
    }
    if (!line) {
      flush();
      continue;
    }
    block.push(line);
  }
  flush();

  if (!sawHeading) warnings.push("No section headings (Experience, Education, Licenses & certifications, Memberships) were found, so nothing could be read safely. Use a CSV, paste the sections with their headings, or add records manually.");
  if (skipped.size > 0) warnings.push(`Skipped sections that are not records: ${[...skipped].join(", ")}.`);
  if (drafts.length >= IMPORT_LIMITS.maxItems) warnings.push(`Only the first ${IMPORT_LIMITS.maxItems} records were read.`);
  return { format: "text", drafts, warnings };
}

// ───────────────────────────── entry point ─────────────────────────────

/** True when the text looks like a CSV with a header row (so a pasted export is handled as CSV). */
function looksLikeCsv(text: string): boolean {
  const first = text.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  if (!first.includes(",")) return false;
  const cols = first.split(",").map(norm);
  return cols.some((c) => ["title", "company name", "school name", "name", "category", "organisation", "organization", "authority", "started on", "start date"].includes(c)) && cols.length >= 3;
}

/** Parses pasted text or CSV into drafts. Never throws on content; input that is too large is reported as a warning. */
export function parseProfileImport(input: string, now: Date): ParseResult {
  const today = now.toISOString().slice(0, 10);
  if (typeof input !== "string" || input.trim() === "") return { format: "text", drafts: [], warnings: ["Nothing to import: paste your profile text or choose a CSV file."] };
  if (input.length > IMPORT_LIMITS.maxChars) return { format: "text", drafts: [], warnings: ["That is too large to import in one go. Import a section at a time."] };
  return looksLikeCsv(input) ? parseCsvImport(input, today) : parseTextImport(input, today);
}

// ───────────────────────────── duplicate keys ─────────────────────────────

const squash = (s: string | undefined) =>
  (s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Normalised identity of a record for duplicate detection: category, title, organisation and the dates. */
export function recordKey(r: { category: string; title?: string; organisationName?: string; startDate?: string; endDate?: string; expiryDate?: string }): string {
  return [r.category, squash(r.title), squash(r.organisationName), r.startDate ?? "", r.endDate ?? "", r.expiryDate ?? ""].join("|");
}

/** Normalised organisation name for matching against FARJI organisations (exact after normalisation only). */
export const normaliseOrganisationName = squash;
