import { PageHeader } from "@/components/ui/PageHeader";
import { ProofPulseDemoClient } from "@/app/proofpulse/ProofPulseDemoClient";

export default function ProofPulsePage() {
  return (
    <div>
      <PageHeader
        title="ProofPulse"
        subtitle="Periodic Merkle-batched re-attestation of currently-active credentials — one institutional action updates the current verification state of thousands of credentials at once."
      />
      <ProofPulseDemoClient />
    </div>
  );
}
