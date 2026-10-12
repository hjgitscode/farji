import type { Metadata } from "next";
import Link from "next/link";
import { requireCandidate } from "@/lib/auth/guards";
import { readContent, REQUEST_STATUS_LABEL } from "@/lib/core/claims";
import { getDb } from "@/lib/database/client";
import { listCandidateClaims } from "@/server/candidate/claims";

export const metadata: Metadata = { title: "My records" };

export default async function ClaimsPage() {
  const actor = await requireCandidate("/candidate/claims");
  const claims = await listCandidateClaims(getDb(), actor);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">My records</h1>
        <Link href="/candidate/claims/new" className="rounded bg-neutral-900 px-3 py-2 text-sm text-white">
          Add a record
        </Link>
      </div>

      {claims.length === 0 ? (
        <p className="text-neutral-700">You have not added any records yet.</p>
      ) : (
        <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
          {claims.map((claim) => {
            const content = readContent(claim.latestVersion?.content);
            const latestRequest = claim.latestVersion?.verificationRequests[0];
            return (
              <li key={claim.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <Link href={`/candidate/claims/${claim.id}`} className="font-medium underline">
                    {content.title ?? "Untitled"}
                  </Link>
                  <p className="text-sm text-neutral-600">
                    {content.organisationName} · {claim.category.toLowerCase()} · version {claim.latestVersion?.versionNumber}
                  </p>
                </div>
                <p className="text-sm text-neutral-700">
                  {latestRequest ? `Request: ${REQUEST_STATUS_LABEL[latestRequest.status] ?? latestRequest.status}` : "No request yet"}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
