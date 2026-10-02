import type { Metadata } from "next";

export const metadata: Metadata = { title: "Issuer dashboard" };

export default function IssuerDashboardPage() {
  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-semibold">Issuer dashboard</h1>
      <p className="text-neutral-700">Placeholder. Access control is not implemented yet.</p>
    </section>
  );
}
