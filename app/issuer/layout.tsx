import { PrivateShell, type NavItem } from "@/components/layout/PrivateShell";
import { requireIssuer } from "@/lib/auth/guards";

const NAV: NavItem[] = [
  { href: "/issuer", label: "Overview", icon: "grid", group: "Workspace" },
  { href: "/issuer/requests", label: "Requests", icon: "inbox", group: "Verification" },
  { href: "/issuer/credentials", label: "Credentials", icon: "pen", group: "Verification" },
  { href: "/issuer/cohort", label: "Batches", icon: "layers", group: "Verification" },
  { href: "/issuer/pulse", label: "Current relationships", icon: "users", group: "Verification" },
  { href: "/issuer/history", label: "History", icon: "history", group: "Records" },
  { href: "/issuer/transactions", label: "Activity", icon: "activity", group: "Records" },
  { href: "/issuer/wallet", label: "Signing wallet", icon: "wallet", group: "Authority" },
];

export default async function IssuerLayout({ children }: { children: React.ReactNode }) {
  await requireIssuer("/issuer");
  return (
    <PrivateShell role="issuer" nav={NAV}>
      {children}
    </PrivateShell>
  );
}
