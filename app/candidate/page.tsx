import { PageHeader } from "@/components/ui/PageHeader";
import { CandidateDashboardClient } from "@/app/candidate/CandidateDashboardClient";
import { getCandidateById, getCredentialsByCandidate } from "@/lib/services/candidateService";

const DEMO_CANDIDATE_ID = "CAND-001";

export default function CandidatePage() {
  const candidate = getCandidateById(DEMO_CANDIDATE_ID);
  const credentials = getCredentialsByCandidate(DEMO_CANDIDATE_ID);

  if (!candidate) return null;

  return (
    <div>
      <PageHeader
        title="Candidate Dashboard"
        subtitle="A demo candidate's claims, each with its own lifecycle type and current verification state."
      />
      <CandidateDashboardClient candidate={candidate} initialCredentials={credentials} />
    </div>
  );
}
