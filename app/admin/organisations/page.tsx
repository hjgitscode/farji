import type { Metadata } from "next";
import Link from "next/link";
import { createOrganisationAction } from "@/app/admin/actions";
import { Alert, Badge, btn, Disclosure, EmptyState, Icon, inputClass, PageHeader } from "@/components/ui";
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
      <PageHeader title="Organisations" description="Institutions that can confirm records." />

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
            <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-card">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-xs font-medium uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th scope="col" className="px-4 py-2.5">Organisation</th>
                    <th scope="col" className="px-4 py-2.5">Type</th>
                    <th scope="col" className="px-4 py-2.5">Status</th>
                    <th scope="col" className="px-4 py-2.5">Next step</th>
                    <th scope="col" className="px-4 py-2.5"><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {organisations.map((o) => {
                    const s = ORG_STATUS[o.status] ?? { tone: "neutral" as const, label: o.status, note: "" };
                    return (
                      <tr key={o.id} className="transition hover:bg-neutral-50">
                        <td className="px-4 py-3">
                          <Link href={`/admin/organisations/${o.id}`} className="font-semibold text-neutral-900 hover:text-emerald-800 hover:underline">
                            {o.displayName.trim()}
                          </Link>
                          {o.legalName !== o.displayName ? <p className="text-xs text-neutral-500">{o.legalName}</p> : null}
                        </td>
                        <td className="px-4 py-3 text-neutral-700">{KIND[o.kind] ?? o.kind.toLowerCase().replaceAll("_", " ")}</td>
                        <td className="px-4 py-3">
                          <Badge tone={s.tone} icon={o.status === "ACTIVE" ? "check" : o.status === "SUSPENDED" ? "alert" : "clock"}>
                            {s.label}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-neutral-600">{s.note}</td>
                        <td className="px-4 py-3 text-right">
                          <Link href={`/admin/organisations/${o.id}`} className={btn.link}>
                            Open
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
