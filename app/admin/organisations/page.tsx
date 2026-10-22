import type { Metadata } from "next";
import Link from "next/link";
import { createOrganisationAction } from "@/app/admin/actions";
import { Alert, Badge, btn, Disclosure, EmptyState, Icon, inputClass, PageHeader, RowList } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/guards";
import { getDb } from "@/lib/database/client";
import { ORG_STATUS } from "@/lib/ui/status";
import { adminListOrganisations } from "@/server/chain/queries";

export const metadata: Metadata = { title: "Organisations" };

const KIND: Record<string, string> = { EMPLOYER: "Employer", EDUCATION: "Education", LICENSING_BODY: "Licensing body", ASSOCIATION: "Association", OTHER: "Other" };

export default async function AdminOrganisationsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const actor = await requireAdmin("/admin/organisations");
  const organisations = await adminListOrganisations(getDb(), actor);

  return (
    <div>
      <PageHeader title="Organisations" description="Employers, universities and licensing bodies that can confirm records." />

      <div className="space-y-6">
        <Disclosure summary={<span className="inline-flex items-center gap-2"><Icon name="plus" className="size-4 text-emerald-700" />Add an organisation</span>} defaultOpen={Boolean(error)}>
          <form action={createOrganisationAction} className="grid max-w-2xl gap-3 sm:grid-cols-2">
            <p className="text-sm text-neutral-600 sm:col-span-2">It starts as awaiting registration. Registering it with your wallet activates it.</p>
            {error ? (
              <div className="sm:col-span-2">
                <Alert tone="error">{error}</Alert>
              </div>
            ) : null}
            <input name="legalName" required placeholder="Legal name" aria-label="Legal name" className={inputClass} />
            <input name="displayName" required placeholder="Display name" aria-label="Display name" className={inputClass} />
            <input name="slug" required placeholder="short-name (lowercase-with-hyphens)" aria-label="Short name" className={inputClass} />
            <select name="kind" aria-label="Kind of organisation" className={inputClass} defaultValue="EMPLOYER">
              <option value="EMPLOYER">Employer</option>
              <option value="EDUCATION">Education</option>
              <option value="LICENSING_BODY">Licensing body</option>
              <option value="ASSOCIATION">Association</option>
              <option value="OTHER">Other</option>
            </select>
            <div className="sm:col-span-2">
              <button type="submit" className={btn.primary}>
                Add organisation
              </button>
            </div>
          </form>
        </Disclosure>

        <section className="space-y-3" aria-label="All organisations">
          <h2 className="text-base font-semibold tracking-tight">All organisations</h2>
          {organisations.length === 0 ? (
            <EmptyState title="No organisations yet" icon="building">
              Add the first one above. Once registered on the network it can have issuer wallets authorised.
            </EmptyState>
          ) : (
            <RowList>
              {organisations.map((o) => {
                const s = ORG_STATUS[o.status] ?? { tone: "neutral" as const, label: o.status, note: "" };
                return (
                  <li key={o.id}>
                    <Link href={`/admin/organisations/${o.id}`} className="group flex flex-wrap items-center justify-between gap-3 px-4 py-4 transition hover:bg-neutral-50 sm:px-5">
                      <div className="flex min-w-0 items-start gap-3.5">
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500">
                          <Icon name="building" className="size-5" />
                        </span>
                        <div className="min-w-0">
                          <p className="font-semibold text-neutral-900 group-hover:text-emerald-800">{o.displayName}</p>
                          <p className="text-sm text-neutral-600">
                            {o.legalName !== o.displayName ? `${o.legalName} · ` : ""}
                            {KIND[o.kind] ?? o.kind.toLowerCase().replaceAll("_", " ")}
                          </p>
                          <p className="text-xs text-neutral-500">{s.note}</p>
                        </div>
                      </div>
                      <span className="flex items-center gap-3">
                        <Badge tone={s.tone} icon={o.status === "ACTIVE" ? "check" : o.status === "SUSPENDED" ? "alert" : "clock"}>
                          {s.label}
                        </Badge>
                        <Icon name="chevron-right" className="size-4 text-neutral-400 transition group-hover:translate-x-0.5" />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </RowList>
          )}
        </section>
      </div>
    </div>
  );
}
