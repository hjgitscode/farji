import { PrivateShell } from "@/components/layout/PrivateShell";

export default function IssuerLayout({ children }: { children: React.ReactNode }) {
  return <PrivateShell>{children}</PrivateShell>;
}
