import type { Metadata } from "next";
import Link from "next/link";
import { createOrganisationAction } from "@/app/admin/actions";
import { requireAdmin } from "@/lib/auth/guards";
import { getDb } from "@/lib/database/client";
import { adminListOrganisations } from "@/server/chain/queries";

export const metadata: Metadata = { title: "Organisations" };

const input = "w-full rounded border border-neutral-300 px-3 py-2";

export default async function AdminOrganisationsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const actor = await requireAdmin("/admin/organisations");
  const organisations = await adminListOrganisations(getDb(), actor);

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">Organisations</h1>

      <form action={createOrganisationAction} className="max-w-xl space-y-3 rounded border border-neutral-200 p-4">
        <h2 className="font-medium">Add an organisation</h2>
        <p className="text-sm text-neutral-700">It starts as pending. Registering it on-chain (with your wallet) activates it.</p>
        {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
        <input name="legalName" required placeholder="Legal name" aria-label="Legal name" className={input} />
        <input name="displayName" required placeholder="Display name" aria-label="Display name" className={input} />
        <input name="slug" required placeholder="slug (lowercase-with-hyphens)" aria-label="Slug" className={input} />
        <select name="kind" aria-label="Kind" className={input} defaultValue="EMPLOYER">
          <option value="EMPLOYER">Employer</option>
          <option value="EDUCATION">Education</option>
          <option value="LICENSING_BODY">Licensing body</option>
          <option value="ASSOCIATION">Association</option>
          <option value="OTHER">Other</option>
        </select>
        <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-white">
          Add organisation
        </button>
      </form>

      <ul className="space-y-2">
        {organisations.map((o) => (
          <li key={o.id} className="rounded border border-neutral-200 p-3">
            <Link href={`/admin/organisations/${o.id}`} className="font-medium underline">
              {o.displayName}
            </Link>{" "}
            <span className="text-sm text-neutral-700">
              · {o.kind.toLowerCase().replaceAll("_", " ")} · {o.status.toLowerCase().replaceAll("_", " ")}
            </span>
          </li>
        ))}
        {organisations.length === 0 ? <li className="text-sm text-neutral-700">No organisations yet.</li> : null}
      </ul>
    </section>
  );
}
