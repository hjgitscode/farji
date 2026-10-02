import { PrivateShell } from "@/components/layout/PrivateShell";

export default function CandidateLayout({ children }: { children: React.ReactNode }) {
  return <PrivateShell>{children}</PrivateShell>;
}
