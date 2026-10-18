import type { Metadata } from "next";
import Link from "next/link";
import { requireIssuer } from "@/lib/auth/guards";
import { readContent, REQUEST_STATUS_LABEL } from "@/lib/core/claims";
import { getDb } from "@/lib/database/client";
import { listIssuerRequests } from "@/server/issuer/review";

export const metadata: Metadata = { title: "Verification requests" };

export default async function IssuerRequestsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { show } = await searchParams;
  const actor = await requireIssuer("/issuer/requests");
  const filter = show === "all" ? "all" : "open";
  const requests = await listIssuerRequests(getDb(), actor, filter);

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Verification requests</h1>
      <p className="text-sm">
        {filter === "open" ? (
          <Link href="/issuer/requests?show=all" className="underline">
            Show all requests, including decided ones
          </Link>
        ) : (
          <Link href="/issuer/requests" className="underline">
            Show open requests only
          </Link>
        )}
      </p>
      {requests.length === 0 ? (
        <p className="text-neutral-700">No requests.</p>
      ) : (
        <ul className="space-y-3">
          {requests.map((r) => {
            const c = readContent(r.claimVersion.content);
            return (
              <li key={r.id} className="rounded border border-neutral-200 p-3">
                <p className="font-medium">
                  <Link href={`/issuer/requests/${r.id}`} className="underline">
                    {c.title}
                  </Link>{" "}
                  · {c.organisationName}
                </p>
                <p className="text-sm text-neutral-700">
                  {r.claimVersion.claim.category.toLowerCase()} · {r.claimVersion.proposedLifecycleType.toLowerCase()} · version{" "}
                  {r.claimVersion.versionNumber} · submitted {r.submittedAt.toISOString().slice(0, 10)} ·{" "}
                  {REQUEST_STATUS_LABEL[r.status] ?? r.status}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
