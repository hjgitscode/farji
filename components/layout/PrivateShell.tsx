import { signOutAction } from "@/lib/auth/actions";
import { PageShell, type NavItem } from "./PageShell";

/** Shell for private areas: navigation for the ONE area the user belongs to, plus sign-out. No cross-role links. */
export function PrivateShell({ children, nav = [] }: { children: React.ReactNode; nav?: NavItem[] }) {
  return (
    <PageShell
      nav={nav}
      wide
      actions={
        <form action={signOutAction}>
          <button type="submit" className="rounded-lg px-3 py-1.5 font-medium text-neutral-700 hover:bg-neutral-100">
            Sign out
          </button>
        </form>
      }
    >
      {children}
    </PageShell>
  );
}
