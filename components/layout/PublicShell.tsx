import { PageShell, type NavItem } from "./PageShell";

const publicNav: NavItem[] = [
  { href: "/verify", label: "Verify a credential" },
  { href: "/login", label: "Sign in" },
  { href: "/signup", label: "Create account" },
];

export function PublicShell({ children }: { children: React.ReactNode }) {
  return <PageShell nav={publicNav}>{children}</PageShell>;
}
