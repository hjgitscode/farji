// Consistent date and label formatting for every page (UTC, locale-independent so server and
// client render identically). Pure.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `12 Mar 2026` (UTC). */
export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value) : value;
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** `12 Mar 2026, 14:05 UTC`. */
export function formatDateTime(value: Date | null | undefined): string {
  if (!value || Number.isNaN(value.getTime())) return "";
  const hh = String(value.getUTCHours()).padStart(2, "0");
  const mm = String(value.getUTCMinutes()).padStart(2, "0");
  return `${formatDate(value)}, ${hh}:${mm} UTC`;
}

/** `Jan 2022 – Present`, `2022-01-10 → 2024-03-31` rendered for people. */
export function formatPeriod(start: string | undefined, end: string | undefined, current: boolean): string {
  const s = formatDate(start);
  if (!s) return "";
  if (current) return `${s} – Present`;
  const e = formatDate(end);
  return e ? `${s} – ${e}` : s;
}

export const CATEGORY_LABEL: Record<string, string> = {
  EXPERIENCE: "Experience",
  EDUCATION: "Education",
  CERTIFICATION: "Certification",
  MEMBERSHIP: "Membership",
};

export const CATEGORY_PLURAL: Record<string, string> = {
  EXPERIENCE: "Experience",
  EDUCATION: "Education",
  CERTIFICATION: "Certifications & licences",
  MEMBERSHIP: "Memberships",
};

export const LIFECYCLE_LABEL: Record<string, string> = {
  PERMANENT: "Completed",
  CONTINUING: "Current",
  EXPIRING: "Expires",
};
