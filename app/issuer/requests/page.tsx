import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
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
            <Link href="/issuer/requests?show=all" className="text-sm font-medium underline">
              Show decided requests too
            </Link>
          ) : (
            <Link href="/issuer/requests" className="text-sm font-medium underline">
              Show open requests only
            </Link>
          )
        }
      />
      {requests.length === 0 ? (
        <EmptyState title={filter === "open" ? "No open requests" : "No requests yet"}>New requests from candidates appear here.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {requests.map((r) => {
            const c = readContent(r.claimVersion.content);
            const open = r.status === "SUBMITTED" || r.status === "IN_REVIEW";
            return (
              <Card as="li" key={r.id} className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/issuer/requests/${r.id}`} className="font-semibold text-neutral-900 hover:underline">
                    {c.title}
                  </Link>
                  <p className="text-sm text-neutral-700">
                    {c.organisationName} · {CATEGORY_LABEL[r.claimVersion.claim.category] ?? r.claimVersion.claim.category} · {LIFECYCLE_LABEL[r.claimVersion.proposedLifecycleType] ?? ""}
                  </p>
                  <p className="text-xs text-neutral-500">
                    Submitted {formatDate(r.submittedAt)} · version {r.claimVersion.versionNumber}
                  </p>
                </div>
                <Badge tone={open ? "pending" : "neutral"}>{REQUEST_STATUS_LABEL[r.status] ?? r.status}</Badge>
              </Card>
            );
          })}
        </ul>
      )}
    </div>
  );
}
