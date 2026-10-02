import { PrivateShell } from "@/components/layout/PrivateShell";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <PrivateShell>{children}</PrivateShell>;
}
