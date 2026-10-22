import Link from "next/link";
import { Icon, StatusBadge } from "@/components/ui";
import { formatDate, formatPeriod, LIFECYCLE_LABEL } from "@/lib/format";
import { presentState } from "@/lib/verification/present";
import type { CandidateRecord } from "@/server/verification/records";

const VISIBILITY = { PRIVATE: "Private", UNLISTED: "Shared by link", PUBLIC: "Public" } as const;

/** One entry in a profile section (experience, education, ...): an organisation tile, the record, and its derived state. */
export function RecordRow({ record, available }: { record: CandidateRecord; available: boolean }) {
  const c = record.current.content;
  const lifecycle = record.result?.lifecycleType ?? record.current.proposedLifecycleType;
  const current = lifecycle === "CONTINUING" && record.result?.state !== "ENDED";
  const p = record.result ? presentState(record.result) : null;
  const initial = (c.organisationName ?? "?").trim().charAt(0).toUpperCase();
  return (
    <li className="flex gap-4 py-4 first:pt-0 last:pb-0">
      <span className="flex size-12 shrink-0 items-center justify-center rounded-md border border-neutral-200 bg-neutral-100 text-lg font-semibold text-neutral-600" aria-hidden="true">
        {initial}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <Link href={`/candidate/claims/${record.claimId}`} className="font-semibold leading-snug text-neutral-900 hover:text-emerald-800 hover:underline">
            {c.title || "Untitled record"}
          </Link>
          {p ? <StatusBadge presentation={p} /> : null}
        </div>
        <p className="text-sm text-neutral-800">{c.organisationName}</p>
        <p className="text-sm text-neutral-500">
          {formatPeriod(c.startDate, c.endDate, current)}
          {c.expiryDate ? ` · expires ${formatDate(c.expiryDate)}` : ""}
          {` · ${LIFECYCLE_LABEL[lifecycle] ?? ""}`}
        </p>
        {p ? <p className="text-sm text-neutral-600">{p.headline}</p> : !available ? <p className="text-sm text-neutral-600">Verification status is unavailable right now.</p> : null}
        {record.earlierVerified ? (
          <p className="text-sm text-amber-900">
            An earlier version of this record was verified{record.earlierVerified.organisationName ? ` by ${record.earlierVerified.organisationName}` : ""}. The current version is not verified yet.
          </p>
        ) : null}
        <p className="flex items-center gap-1.5 text-xs text-neutral-400">
          <Icon name={record.visibility === "PRIVATE" ? "lock" : record.visibility === "PUBLIC" ? "globe" : "link"} className="size-3.5" />
          {VISIBILITY[record.visibility]}
        </p>
      </div>
    </li>
  );
}
