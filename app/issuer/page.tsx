import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { EpochTimeline } from "@/components/proof-timeline/EpochTimeline";
import { PendingRequestsPanel } from "@/app/issuer/PendingRequestsPanel";
import { BatchCreationPanel } from "@/app/issuer/BatchCreationPanel";
import { RevokeCredentialPanel } from "@/app/issuer/RevokeCredentialPanel";
import { getPendingCredentials } from "@/lib/services/issuerService";
import { getAttestations } from "@/lib/services/attestationService";
import { getOrganisationById } from "@/lib/services/organisationService";
import { cohortStudents } from "@/lib/mock-data/cohortDemo";
import { augustLeaves } from "@/lib/mock-data/proofPulseDemo";

// EpochTimeline computes chain continuity assuming every epoch it's given
// belongs to the same organisation + attestation-type stream, so each
// stream must be rendered as its own timeline rather than one mixed list.
function groupByStream(epochs: ReturnType<typeof getAttestations>) {
  const groups = new Map<string, typeof epochs>();
  for (const epoch of epochs) {
    const key = `${epoch.organisationId}:${epoch.attestationType}`;
    groups.set(key, [...(groups.get(key) ?? []), epoch]);
  }
  return [...groups.entries()];
}

export default function IssuerPage() {
  const pending = getPendingCredentials();
  const streams = groupByStream(getAttestations());

  return (
    <div className="space-y-8">
      <PageHeader
        title="Issuer Dashboard"
        subtitle="Demo issuer view — approve claims, batch-attest with CohortProof/ProofPulse, and revoke credentials."
      />

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Pending Verification Requests</h2>
        <PendingRequestsPanel initialPending={pending} />
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BatchCreationPanel
          title="Create CohortProof (as IIT Delhi Demo Issuer)"
          actionLabel="Create CohortProof"
          items={cohortStudents}
        />
        <BatchCreationPanel
          title="Create ProofPulse (as XYZ Technologies Demo)"
          actionLabel="Create ProofPulse"
          items={augustLeaves}
        />
      </section>

      <section>
        <RevokeCredentialPanel />
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Previous Attestation Epochs</h2>
        {streams.map(([key, epochs]) => {
          const [organisationId, attestationType] = key.split(":");
          const organisation = getOrganisationById(organisationId);
          return (
            <Card key={key}>
              <p className="mb-3 text-sm font-semibold text-slate-500">
                {organisation?.name ?? organisationId} — {attestationType.replace("_", " ")}
              </p>
              <EpochTimeline epochs={epochs} />
            </Card>
          );
        })}
      </section>
    </div>
  );
}
