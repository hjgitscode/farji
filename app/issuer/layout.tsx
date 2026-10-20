import { PrivateShell } from "@/components/layout/PrivateShell";
import { requireIssuer } from "@/lib/auth/guards";

const NAV = [
  { href: "/issuer", label: "Dashboard" },
  { href: "/issuer/requests", label: "Requests" },
  { href: "/issuer/credentials", label: "Credentials" },
  { href: "/issuer/cohort", label: "Batches" },
  { href: "/issuer/pulse", label: "Current relationships" },
  { href: "/issuer/history", label: "History" },
  { href: "/issuer/transactions", label: "Activity" },
  { href: "/issuer/wallet", label: "Wallet" },
];

export default async function IssuerLayout({ children }: { children: React.ReactNode }) {
  await requireIssuer("/issuer");
  return <PrivateShell nav={NAV}>{children}</PrivateShell>;
}
