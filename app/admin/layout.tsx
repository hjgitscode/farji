import { PrivateShell } from "@/components/layout/PrivateShell";
import { requireAdmin } from "@/lib/auth/guards";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin("/admin");
  return <PrivateShell>{children}</PrivateShell>;
}
