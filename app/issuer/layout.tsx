import { PrivateShell } from "@/components/layout/PrivateShell";
import { requireIssuer } from "@/lib/auth/guards";

export default async function IssuerLayout({ children }: { children: React.ReactNode }) {
  await requireIssuer("/issuer");
  return <PrivateShell>{children}</PrivateShell>;
}
