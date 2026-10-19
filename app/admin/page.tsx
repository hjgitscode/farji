import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/guards";

export const metadata: Metadata = { title: "Admin dashboard" };

export default async function AdminDashboardPage() {
  await requireAdmin("/admin");
  return (
    <section className="space-y-3">
      <h1 className="text-2xl font-semibold">Admin dashboard</h1>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <Link href="/admin/organisations" className="underline">
            Organisations and issuer wallets
          </Link>
        </li>
        <li>
          <Link href="/admin/transactions" className="underline">
            Blockchain transactions
          </Link>
        </li>
      </ul>
    </section>
  );
}
