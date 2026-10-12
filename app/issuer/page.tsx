import type { Metadata } from "next";
import { requireIssuer } from "@/lib/auth/guards";

export const metadata: Metadata = { title: "Issuer dashboard" };

export default async function IssuerDashboardPage() {
  await requireIssuer("/issuer");
  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-semibold">Issuer dashboard</h1>
      <p className="text-neutral-700">Incoming verification requests will appear here.</p>
    </section>
  );
}
