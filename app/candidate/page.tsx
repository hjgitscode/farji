import type { Metadata } from "next";
import { requireCandidate } from "@/lib/auth/guards";

export const metadata: Metadata = { title: "Candidate dashboard" };

export default async function CandidateDashboardPage() {
  await requireCandidate("/candidate");
  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-semibold">Candidate dashboard</h1>
      <p className="text-neutral-700">Your profile and verification requests will appear here.</p>
    </section>
  );
}
