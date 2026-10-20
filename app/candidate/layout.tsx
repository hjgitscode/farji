import { PrivateShell } from "@/components/layout/PrivateShell";
import { requireCandidate } from "@/lib/auth/guards";

const NAV = [
  { href: "/candidate", label: "Dashboard" },
  { href: "/candidate/claims", label: "My records" },
  { href: "/candidate/import", label: "Import" },
  { href: "/candidate/profile", label: "Profile & sharing" },
];

export default async function CandidateLayout({ children }: { children: React.ReactNode }) {
  await requireCandidate("/candidate");
  return <PrivateShell nav={NAV}>{children}</PrivateShell>;
}
