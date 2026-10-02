import type { Metadata } from "next";

export const metadata: Metadata = { title: "Candidate dashboard" };

export default function CandidateDashboardPage() {
  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-semibold">Candidate dashboard</h1>
      <p className="text-neutral-700">Placeholder. Access control is not implemented yet.</p>
    </section>
  );
}
