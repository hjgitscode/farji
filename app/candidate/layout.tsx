import { PrivateShell } from "@/components/layout/PrivateShell";
import { requireCandidate } from "@/lib/auth/guards";

export default async function CandidateLayout({ children }: { children: React.ReactNode }) {
  await requireCandidate("/candidate");
  return <PrivateShell>{children}</PrivateShell>;
}
