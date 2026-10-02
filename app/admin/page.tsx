import type { Metadata } from "next";

export const metadata: Metadata = { title: "Admin dashboard" };

export default function AdminDashboardPage() {
  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-semibold">Admin dashboard</h1>
      <p className="text-neutral-700">Placeholder. Access control is not implemented yet.</p>
    </section>
  );
}
