import { PrivateShell, type NavItem } from "@/components/layout/PrivateShell";
import { requireAdmin } from "@/lib/auth/guards";

const NAV: NavItem[] = [
  { href: "/admin", label: "Overview", icon: "grid", group: "Control centre" },
  { href: "/admin/organisations", label: "Organisations", icon: "building", group: "Governance" },
  { href: "/admin/transactions", label: "Transactions", icon: "activity", group: "Governance" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin("/admin");
  return (
    <PrivateShell role="admin" nav={NAV}>
      {children}
    </PrivateShell>
  );
}
