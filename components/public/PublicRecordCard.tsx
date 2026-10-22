import Link from "next/link";
import { Card, categoryIcon, Icon, StatusBadge } from "@/components/ui";
import { CATEGORY_LABEL, formatDate, formatPeriod } from "@/lib/format";
import { presentState } from "@/lib/verification/present";
import type { PublicRecord } from "@/server/public/read";

/**
 * One record on a public profile. Verified and self-declared records are visibly different: only a record with a derived
 * verified-family state carries the "Confirmed by" line; a self-declared record is plainly labelled and has no verifier link.
 */
export function PublicRecordCard({ record }: { record: PublicRecord }) {
  const p = presentState(record.result, "public");
  const current = record.lifecycleType === "CONTINUING" && record.result.state !== "ENDED";
  const verified = record.group === "VERIFIED";
  const attention = record.group === "ATTENTION";
  return (
    <Card as="li" className={`space-y-3 ${verified ? "border-emerald-200 bg-gradient-to-br from-white to-emerald-50/40" : attention ? "border-rose-200" : "border-dashed bg-white/70"}`}>
      <div className="flex items-start gap-3.5">
        <span className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${verified ? "bg-emerald-100 text-emerald-700" : "bg-neutral-100 text-neutral-500"}`}>
          <Icon name={categoryIcon(record.category)} className="size-5" />
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-semibold leading-snug text-neutral-900">{record.title}</h3>
          <p className="text-sm text-neutral-700">
            {record.organisationName} · {CATEGORY_LABEL[record.category] ?? record.category}
            {record.fieldOfStudy ? ` · ${record.fieldOfStudy}` : ""}
          </p>
          <p className="text-xs text-neutral-500">
            {formatPeriod(record.startDate, record.endDate, current)}
            {record.expiryDate ? ` · expires ${formatDate(record.expiryDate)}` : ""}
            {record.location ? ` · ${record.location}` : ""}
          </p>
        </div>
      </div>
      {record.description ? <p className="text-sm leading-relaxed text-neutral-700">{record.description}</p> : null}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <StatusBadge presentation={p} />
        <span className="text-neutral-700">{p.headline}</span>
      </div>
      {verified && record.result.organisation ? <p className="text-xs text-neutral-600">Confirmed by {record.result.organisation.displayName}</p> : null}
      {record.verifyRef ? (
        <p>
          <Link href={`/verify/${record.verifyRef}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-800 underline decoration-emerald-300 underline-offset-4 transition hover:text-emerald-900">
            View verification
            <Icon name="arrow-right" className="size-3.5" />
          </Link>
        </p>
      ) : null}
    </Card>
  );
}
