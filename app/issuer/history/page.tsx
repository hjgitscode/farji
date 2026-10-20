import type { Metadata } from "next";
import { Alert, Badge, Card, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { requireIssuer } from "@/lib/auth/guards";
import { getDb } from "@/lib/database/client";
import { CATEGORY_LABEL, LIFECYCLE_LABEL } from "@/lib/format";
import { presentState } from "@/lib/verification/present";
import { deriveIssuerHistory } from "@/server/verification/records";

export const metadata: Metadata = { title: "Verification history" };

export default async function IssuerHistoryPage() {
  const actor = await requireIssuer("/issuer/history");
  const { available, rows } = await deriveIssuerHistory(getDb(), actor);
  return (
    <div className="space-y-6">
      <PageHeader title="Verification history" description="Where each credential your organisation issued stands today, as anyone checking it would see." />
      {!available ? <Alert tone="warning">Status is unavailable right now.</Alert> : null}
      {rows.length === 0 ? (
        <EmptyState title="Nothing issued yet">Credentials appear here once you approve a request.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const p = r.result ? presentState(r.result) : null;
            return (
              <Card as="li" key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">{r.content.title}</p>
                  <p className="text-sm text-neutral-700">
                    {r.content.organisationName} · {CATEGORY_LABEL[r.category] ?? r.category} · {LIFECYCLE_LABEL[r.lifecycleType] ?? ""} · version {r.versionNumber}
                  </p>
                  {p ? <p className="text-sm text-neutral-600">{p.headline}</p> : null}
                </div>
                {p ? <StatusBadge presentation={p} /> : <Badge>Unavailable</Badge>}
              </Card>
            );
          })}
        </ul>
      )}
    </div>
  );
}
