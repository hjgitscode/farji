import Link from "next/link";
import { Card, StatusBadge } from "@/components/ui";
import { CATEGORY_LABEL, formatDate, formatPeriod } from "@/lib/format";
import { presentState } from "@/lib/verification/present";
import type { PublicRecord } from "@/server/public/read";

/**
 * One record on a public profile. Verified and self-declared records are visibly different: only a record with a derived
 * verified-family state carries the "Verified by" line; a self-declared record is plainly labelled and has no verifier link.
 */
export function PublicRecordCard({ record }: { record: PublicRecord }) {
  const p = presentState(record.result, "public");
  const current = record.lifecycleType === "CONTINUING" && record.result.state !== "ENDED";
  const verified = record.group === "VERIFIED";
  return (
    <Card as="li" className={`space-y-2 ${verified ? "border-emerald-200" : record.group === "ATTENTION" ? "border-rose-200" : "border-dashed"}`}>
      <div>
        <h3 className="text-base font-semibold text-neutral-900">{record.title}</h3>
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
      {record.description ? <p className="text-sm text-neutral-700">{record.description}</p> : null}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <StatusBadge presentation={p} />
        <span className="text-neutral-800">{p.headline}</span>
      </div>
      {verified && record.result.organisation ? <p className="text-xs text-neutral-600">Confirmed by {record.result.organisation.displayName}</p> : null}
      {record.verifyRef ? (
        <p>
          <Link href={`/verify/${record.verifyRef}`} className="text-sm font-medium text-neutral-900 underline underline-offset-2">
            View verification
          </Link>
        </p>
      ) : null}
    </Card>
  );
}
