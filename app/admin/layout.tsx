import { PrivateShell } from "@/components/layout/PrivateShell";
import { requireAdmin } from "@/lib/auth/guards";

const NAV = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/organisations", label: "Organisations" },
  { href: "/admin/transactions", label: "Transactions" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin("/admin");
  return <PrivateShell nav={NAV}>{children}</PrivateShell>;
}
