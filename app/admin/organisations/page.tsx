import type { Metadata } from "next";
import Link from "next/link";
import { createOrganisationAction } from "@/app/admin/actions";
import { Alert, Badge, btn, Card, EmptyState, inputClass, PageHeader, Section } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/guards";
import { getDb } from "@/lib/database/client";
import { adminListOrganisations } from "@/server/chain/queries";
import type { Tone } from "@/lib/verification/present";

export const metadata: Metadata = { title: "Organisations" };

const STATUS: Record<string, { tone: Tone; label: string }> = {
  PENDING_ONBOARDING: { tone: "pending", label: "Awaiting registration" },
  ACTIVE: { tone: "verified", label: "Active" },
  SUSPENDED: { tone: "attention", label: "Suspended" },
};

export default async function AdminOrganisationsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const actor = await requireAdmin("/admin/organisations");
  const organisations = await adminListOrganisations(getDb(), actor);

  return (
    <div className="space-y-8">
      <PageHeader title="Organisations" description="Employers, universities and licensing bodies that can confirm records." />

      <Section title="Add an organisation" description="It starts as awaiting registration. Registering it with your wallet activates it.">
        <form action={createOrganisationAction} className="max-w-xl space-y-3 rounded-xl border border-neutral-200 bg-white p-4">
          {error ? <Alert tone="error">{error}</Alert> : null}
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
          <button type="submit" className={btn.primary}>
            Add organisation
          </button>
        </form>
      </Section>

      <Section title="All organisations">
        {organisations.length === 0 ? (
          <EmptyState title="No organisations yet">Add the first one above.</EmptyState>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {organisations.map((o) => {
              const s = STATUS[o.status] ?? { tone: "neutral" as Tone, label: o.status };
              return (
                <Card as="li" key={o.id} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/admin/organisations/${o.id}`} className="font-semibold hover:underline">
                      {o.displayName}
                    </Link>
                    <p className="text-sm text-neutral-600">{o.kind.toLowerCase().replaceAll("_", " ")}</p>
                  </div>
                  <Badge tone={s.tone}>{s.label}</Badge>
                </Card>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}
