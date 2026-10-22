import { PrivateShell, type NavItem } from "@/components/layout/PrivateShell";
import { requireCandidate } from "@/lib/auth/guards";

const NAV: NavItem[] = [
  { href: "/candidate", label: "Profile", icon: "user" },
  { href: "/candidate/claims", label: "My records", icon: "file" },
  { href: "/candidate/import", label: "Import", icon: "upload" },
  { href: "/candidate/profile", label: "Profile & sharing", icon: "share" },
];

export default async function CandidateLayout({ children }: { children: React.ReactNode }) {
  await requireCandidate("/candidate");
  return (
    <PrivateShell role="candidate" nav={NAV}>
      {children}
    </PrivateShell>
  );
}
