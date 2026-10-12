import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/guards";

export const metadata: Metadata = { title: "Admin dashboard" };

export default async function AdminDashboardPage() {
  await requireAdmin("/admin");
  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-semibold">Admin dashboard</h1>
      <p className="text-neutral-700">Organisation and issuer-wallet administration will appear here.</p>
    </section>
  );
}
