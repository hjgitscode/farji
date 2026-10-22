import type { Metadata } from "next";
import { Alert, Badge, categoryIcon, EmptyState, Icon, PageHeader, RowList, StatusBadge } from "@/components/ui";
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
    <div>
      <PageHeader title="Verification history" description="Where each credential your organisation issued stands today, as anyone checking it would see." />
      <div className="space-y-4">
        {!available ? <Alert tone="warning">Status is unavailable right now.</Alert> : null}
        {rows.length === 0 ? (
          <EmptyState title="Nothing issued yet" icon="history">
            Credentials appear here once you approve a request.
          </EmptyState>
        ) : (
          <RowList>
            {rows.map((r) => {
              const p = r.result ? presentState(r.result) : null;
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
                  <div className="flex min-w-0 items-start gap-3.5">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500">
                      <Icon name={categoryIcon(r.category)} className="size-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold">{r.content.title}</p>
                      <p className="text-sm text-neutral-700">
                        {r.content.organisationName} · {CATEGORY_LABEL[r.category] ?? r.category} · {LIFECYCLE_LABEL[r.lifecycleType] ?? ""} · version {r.versionNumber}
                      </p>
                      {p ? <p className="text-sm text-neutral-600">{p.headline}</p> : null}
                    </div>
                  </div>
                  {p ? <StatusBadge presentation={p} /> : <Badge>Unavailable</Badge>}
                </li>
              );
            })}
          </RowList>
        )}
      </div>
    </div>
  );
}
