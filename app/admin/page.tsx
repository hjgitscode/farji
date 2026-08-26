import { PageHeader } from "@/components/ui/PageHeader";
import { OrganisationsTable } from "@/app/admin/OrganisationsTable";
import { AdminDashboardClient } from "@/app/admin/AdminDashboardClient";
import { getOrganisations } from "@/lib/services/organisationService";
import { getIssuerKeyHistory } from "@/lib/services/issuerService";

export default function AdminPage() {
  const organisations = getOrganisations();
  const keyHistory = getIssuerKeyHistory();

  return (
    <div className="space-y-8">
      <PageHeader
        title="Admin Dashboard"
        subtitle="Manage the issuer registry: which wallets are authorised to attest on behalf of which organisation, and when."
      />

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Organisations</h2>
        <OrganisationsTable organisations={organisations} />
      </section>

      <section>
        <AdminDashboardClient initialRecords={keyHistory} />
      </section>
    </div>
  );
}
