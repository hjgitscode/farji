import Link from "next/link";
import { Badge, Card, categoryIcon, Icon, StatusBadge } from "@/components/ui";
import { CATEGORY_LABEL, formatDate, formatPeriod, LIFECYCLE_LABEL } from "@/lib/format";
import { presentState } from "@/lib/verification/present";
import type { CandidateRecord } from "@/server/verification/records";

const VISIBILITY = {
  PRIVATE: { label: "Private", icon: "lock", tone: "neutral" },
  UNLISTED: { label: "Shared by link", icon: "link", tone: "current" },
  PUBLIC: { label: "On public profile", icon: "globe", tone: "verified" },
} as const;

/** One professional record: what it says, its DERIVED state in plain words, and what to do next. */
export function RecordCard({ record, available }: { record: CandidateRecord; available: boolean }) {
  const c = record.current.content;
  const lifecycle = record.result?.lifecycleType ?? record.current.proposedLifecycleType;
  const current = lifecycle === "CONTINUING" && record.result?.state !== "ENDED";
  const p = record.result ? presentState(record.result) : null;
  const vis = VISIBILITY[record.visibility];
  const verified = p?.tone === "verified" || p?.tone === "current";
  return (
    <Card as="li" interactive className="space-y-3">
      <div className="flex items-start gap-3.5">
        <span className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${verified ? "bg-emerald-100 text-emerald-700" : "bg-neutral-100 text-neutral-500"}`}>
          <Icon name={categoryIcon(record.category)} className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <Link href={`/candidate/claims/${record.claimId}`} className="text-base font-semibold leading-snug text-neutral-900 hover:text-emerald-800 hover:underline">
              {c.title || "Untitled record"}
            </Link>
            <Badge tone={vis.tone} icon={vis.icon}>
              {vis.label}
            </Badge>
          </div>
          <p className="text-sm text-neutral-700">
            {c.organisationName} · {CATEGORY_LABEL[record.category] ?? record.category}
          </p>
          <p className="text-xs text-neutral-500">
            {formatPeriod(c.startDate, c.endDate, current)}
            {c.expiryDate ? ` · expires ${formatDate(c.expiryDate)}` : ""}
            {` · ${LIFECYCLE_LABEL[lifecycle] ?? ""}`}
          </p>
        </div>
      </div>
      {p ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-3 text-sm">
          <StatusBadge presentation={p} />
          <span className="text-neutral-700">{p.headline}</span>
        </div>
      ) : !available ? (
        <p className="border-t border-neutral-100 pt-3 text-sm text-neutral-600">Verification status is unavailable right now.</p>
      ) : null}
      {record.earlierVerified ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950">
          An earlier version of this record was verified{record.earlierVerified.organisationName ? ` by ${record.earlierVerified.organisationName}` : ""}. The current version is not verified yet.
        </p>
      ) : null}
    </Card>
  );
}
