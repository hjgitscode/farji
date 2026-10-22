import type { Metadata } from "next";
import Link from "next/link";
import { Badge, btn, categoryIcon, EmptyState, Icon, PageHeader, RowList } from "@/components/ui";
import { requireIssuer } from "@/lib/auth/guards";
import { readContent, REQUEST_STATUS_LABEL } from "@/lib/core/claims";
import { getDb } from "@/lib/database/client";
import { CATEGORY_LABEL, formatDate, LIFECYCLE_LABEL } from "@/lib/format";
import { listIssuerRequests } from "@/server/issuer/review";

export const metadata: Metadata = { title: "Requests" };

export default async function IssuerRequestsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { show } = await searchParams;
  const actor = await requireIssuer("/issuer/requests");
  const filter = show === "all" ? "all" : "open";
  const requests = await listIssuerRequests(getDb(), actor, filter);

  return (
    <div>
      <PageHeader
        title="Verification requests"
        description="People asking your organisation to confirm a record. Check each against your own files."
        actions={
          filter === "open" ? (
            <Link href="/issuer/requests?show=all" className={btn.secondary}>
              Show decided requests too
            </Link>
          ) : (
            <Link href="/issuer/requests" className={btn.secondary}>
              Show open requests only
            </Link>
          )
        }
      />
      {requests.length === 0 ? (
        <EmptyState title={filter === "open" ? "No open requests" : "No requests yet"} icon="inbox">
          When a candidate asks your organisation to confirm a record, it appears here for review.
        </EmptyState>
      ) : (
        <RowList>
          {requests.map((r) => {
            const c = readContent(r.claimVersion.content);
            const open = r.status === "SUBMITTED" || r.status === "IN_REVIEW";
            return (
              <li key={r.id}>
                <Link href={`/issuer/requests/${r.id}`} className="group flex flex-wrap items-center justify-between gap-3 px-4 py-4 transition hover:bg-neutral-50 sm:px-5">
                  <div className="flex min-w-0 items-start gap-3.5">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500">
                      <Icon name={categoryIcon(r.claimVersion.claim.category)} className="size-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold text-neutral-900 group-hover:text-emerald-800">{c.title}</p>
                      <p className="text-sm text-neutral-700">
                        {c.organisationName} · {CATEGORY_LABEL[r.claimVersion.claim.category] ?? r.claimVersion.claim.category} · {LIFECYCLE_LABEL[r.claimVersion.proposedLifecycleType] ?? ""}
                      </p>
                      <p className="text-xs text-neutral-500">
                        Submitted {formatDate(r.submittedAt)} · version {r.claimVersion.versionNumber}
                      </p>
                    </div>
                  </div>
                  <span className="flex items-center gap-3">
                    <Badge tone={open ? "pending" : "neutral"} icon={open ? "clock" : "check"}>
                      {REQUEST_STATUS_LABEL[r.status] ?? r.status}
                    </Badge>
                    <Icon name="chevron-right" className="size-4 text-neutral-400 transition group-hover:translate-x-0.5" />
                  </span>
                </Link>
              </li>
            );
          })}
        </RowList>
      )}
    </div>
  );
}
